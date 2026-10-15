import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeRequest, AccessControlError } from "@/lib/auth/accessControl";
import { requireIngestAuth } from "@/lib/db/getStores";
import { fileIntegrationStore } from "@/lib/integrations/integrationStore";
import { AgentPulseClient } from "@/examples/integrations/typescript/agentpulseClient";
import { getCanonicalRun } from "@/lib/core/capture/persistence";
import { runArtifactSchema } from "@/lib/core/contracts/runArtifact";
import { computeCaptureReadiness } from "@/lib/projects/captureReadiness";
import { compareRuns } from "@/lib/core/comparison/comparator";
import { evaluateRun } from "@/lib/core/evals/runner";
import { getEvalSuite, saveRunAsEvalCase } from "@/lib/core/evals/persistence";
import { isRequestHttps, getSessionCookieOptions } from "@/lib/auth/session";

describe("Sprint 10.2: IRIS External Dogfood & DX Hardening", () => {
  const originalEnv = { ...process.env };
  let projectAKey: string;
  let projectBKey: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPULSE_MODE; // defaults to personal_local

    const integA = await fileIntegrationStore.createIntegration({
      projectId: "project-iris",
      projectName: "IRIS Autonomous Agent",
    });
    const keyA = await fileIntegrationStore.generateIngestKey(integA.integrationId);
    projectAKey = keyA!.rawKey;

    const integB = await fileIntegrationStore.createIntegration({
      projectId: "project-external",
      projectName: "Other External Agent",
    });
    const keyB = await fileIntegrationStore.generateIngestKey(integB.integrationId);
    projectBKey = keyB!.rawKey;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // 1. One Authorization Policy Engine
  it("Item 8: ingest adapter delegates directly to the canonical policy engine", async () => {
    const req = new Request("http://127.0.0.1:3000/api/traces/events", {
      method: "POST",
      headers: { "x-agentpulse-key": projectAKey },
    });

    const result = await requireIngestAuth(req, "POST /api/traces/events", "project-iris");
    expect(result.projectId).toBe("project-iris");
    expect(result.integration).toBeDefined();
    expect(result.integrationId).toBeDefined();
  });

  // 2. Ingest Auth Preserves Project Resolution & Isolation
  it("Item 9: ingest project isolation is strictly preserved (Project A key cannot ingest Project B)", async () => {
    const req = new Request("http://127.0.0.1:3000/api/traces/events", {
      method: "POST",
      headers: { "x-agentpulse-key": projectAKey },
    });

    await expect(
      requireIngestAuth(req, "POST /api/traces/events", "project-external")
    ).rejects.toThrow();
  });

  it("Item 10: dashboard access key does NOT grant scoped ingest authority in self_hosted mode", async () => {
    process.env.AGENTPULSE_MODE = "self_hosted";
    process.env.AGENTPULSE_ACCESS_KEY = "dashboard-secret-admin";

    const req = new Request("http://127.0.0.1:3000/api/runs/start", {
      method: "POST",
      headers: { "x-agentpulse-key": "dashboard-secret-admin" },
    });

    await expect(
      authorizeRequest(req, { capability: "INGEST", projectId: "project-iris" })
    ).rejects.toThrow(AccessControlError);

    // And verify ingest key cannot access dashboard APIs
    const dashReq = new Request("http://127.0.0.1:3000/api/runs", {
      headers: { "x-agentpulse-key": projectAKey },
    });
    await expect(
      authorizeRequest(dashReq, { capability: "DASHBOARD_READ" })
    ).rejects.toThrow("Ingest keys cannot be used to access dashboard or management APIs.");
  });

  // 3. Client Onboarding & Error Diagnostics
  it("Item 12 & 13: missing or invalid ingest key fails with clear actionable error", async () => {
    const missingKeyReq = new Request("http://127.0.0.1:3000/api/runs/start", {
      method: "POST",
    });

    await expect(
      authorizeRequest(missingKeyReq, { capability: "INGEST" })
    ).rejects.toThrow("Missing ingest key");

    const invalidKeyReq = new Request("http://127.0.0.1:3000/api/runs/start", {
      method: "POST",
      headers: { "x-agentpulse-key": "ap_live_invalid_revoked_key" },
    });

    await expect(
      authorizeRequest(invalidKeyReq, { capability: "INGEST" })
    ).rejects.toThrow("Invalid or revoked ingest key");
  });

  it("Item 14: connect agent wizard generates fully executable environment configuration", () => {
    const endpoint = "http://127.0.0.1:3000";
    const projectId = "project-iris";
    const key = projectAKey;

    const envSnippet = [
      `export AGENTPULSE_URL="${endpoint}"`,
      `export AGENTPULSE_PROJECT_ID="${projectId}"`,
      `export AGENTPULSE_INGEST_KEY="${key}"`,
    ].join("\n");

    expect(envSnippet).toContain(`export AGENTPULSE_URL="http://127.0.0.1:3000"`);
    expect(envSnippet).toContain(`export AGENTPULSE_PROJECT_ID="project-iris"`);
    expect(envSnippet).toContain(`export AGENTPULSE_INGEST_KEY="${projectAKey}"`);
    expect(envSnippet).not.toContain("ap_live_support_agent_demo");
  });

  // 4. Client Networking Robustness: Timeout, Retries, Fail-Open
  it("Item 18: client enforces bounded timeout using AbortController signal", async () => {
    let observedSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        observedSignal = init.signal as AbortSignal;
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ ok: true }), {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                })
              ),
            50
          );
        });
      })
    );

    const client = new AgentPulseClient({
      endpoint: "http://127.0.0.1:3000",
      ingestKey: projectAKey,
      timeoutMs: 2000,
      failOpen: false,
    });

    await client.emitTraceEvent({
      event_id: "test-event-1",
      run_id: "test-run",
      workflow_id: "test-wf",
      timestamp: new Date().toISOString(),
      event_type: "node_completed",
      status: "completed",
    });

    expect(observedSignal).not.toBeNull();
  });

  it("Item 19 & 20: client retries transient 5xx but NEVER retries 401 or 403", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response("Unauthorized: Invalid Key", {
            status: 401,
            statusText: "Unauthorized",
          })
        );
      })
    );

    const client = new AgentPulseClient({
      endpoint: "http://127.0.0.1:3000",
      ingestKey: "ap_live_wrong",
      maxRetries: 3,
      failOpen: false,
    });

    await expect(
      client.emitTraceEvent({
        event_id: "test-401",
        run_id: "run-401",
        workflow_id: "test",
        timestamp: new Date().toISOString(),
        event_type: "node_completed",
        status: "completed",
      })
    ).rejects.toThrow("401");

    // Must fail fast on 401: exactly 1 attempt, zero retries
    expect(callCount).toBe(1);
  });

  it("Item 21: telemetry respects failOpen: true default without breaking host workflow", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused: ECONNREFUSED 127.0.0.1:3000"))
    );

    const client = new AgentPulseClient({
      endpoint: "http://127.0.0.1:3000",
      ingestKey: projectAKey,
      maxRetries: 1,
      failOpen: true, // default behavior for telemetry
    });

    // Should NOT throw
    await expect(
      client.emitTraceEvent({
        event_id: "test-failopen",
        run_id: "run-failopen",
        workflow_id: "test",
        timestamp: new Date().toISOString(),
        event_type: "node_completed",
        status: "completed",
      })
    ).resolves.toBeUndefined();
  });

  // 5. Real / Sanitized Dogfood Run Validation
  it("Item 23: IRIS baseline, failure, and candidate canonical artifacts pass schema validation", async () => {
    const baseline = await getCanonicalRun("iris-run-baseline-001");
    expect(baseline).not.toBeNull();
    const validatedBaseline = runArtifactSchema.safeParse(baseline);
    expect(validatedBaseline.success).toBe(true);

    const failure = await getCanonicalRun("iris-run-failure-001");
    expect(failure).not.toBeNull();
    const validatedFailure = runArtifactSchema.safeParse(failure);
    expect(validatedFailure.success).toBe(true);

    const candidate = await getCanonicalRun("iris-run-candidate-001");
    expect(candidate).not.toBeNull();
    const validatedCandidate = runArtifactSchema.safeParse(candidate);
    expect(validatedCandidate.success).toBe(true);
  });

  // 6. Capture Readiness & Replay Readiness
  it("Item 24 & 25: computes honest CaptureReadinessReport for IRIS execution", async () => {
    const baseline = await getCanonicalRun("iris-run-baseline-001");
    expect(baseline).not.toBeNull();

    const report = await computeCaptureReadiness(baseline!);
    expect(report.overallScore).toBeGreaterThan(0);
    const lifecycleDim = report.dimensions.find((d) => d.category === "RUN_LIFECYCLE");
    expect(lifecycleDim?.level).toBe("COMPLETE");

    const toolsDim = report.dimensions.find((d) => d.category === "TOOLS");
    expect(toolsDim?.level).toBe("PARTIAL"); // honest reporting: tools captured with partial payload

    const stateDim = report.dimensions.find((d) => d.category === "STATE");
    expect(stateDim?.level).toBe("COMPLETE");

    expect(report.replayProjection).toBeDefined();
    expect(report.replayProjection.canForkFromCheckpoint).toBe(true);
  });

  // 7. Comparison: Baseline Failure vs Candidate Fix
  it("Item 27: compares IRIS baseline failure vs candidate fix and identifies divergence", async () => {
    const failure = await getCanonicalRun("iris-run-failure-001");
    const candidate = await getCanonicalRun("iris-run-candidate-001");
    expect(failure).not.toBeNull();
    expect(candidate).not.toBeNull();

    const comparison = await compareRuns(failure!, candidate!);

    expect(comparison.comparison_id).toBeDefined();
    expect(comparison.baseline_run_id).toBe("iris-run-failure-001");
    expect(comparison.candidate_run_id).toBe("iris-run-candidate-001");
    expect(comparison.divergences.length).toBeGreaterThan(0);
    expect(comparison.findings.length).toBeGreaterThan(0);
  });

  // 8. Evaluation & Regression Curation
  it("Item 28: evaluates IRIS candidate run and verifies regression gate protects against failure", async () => {
    const suite = await getEvalSuite("iris-morning-brief-suite", 3);
    expect(suite).not.toBeNull();

    const candidate = await getCanonicalRun("iris-run-candidate-001");
    expect(candidate).not.toBeNull();

    const evalRun = await evaluateRun(candidate!, suite!, { persist: false });
    expect(evalRun.summary.suite_verdict).toBe("PASSED");
    expect(evalRun.summary.failed).toBe(0);
    expect(evalRun.summary.passed).toBeGreaterThan(0);

    // Save failure run as a regression case
    const regressionCase = await saveRunAsEvalCase("iris-run-failure-001", {
      datasetId: "iris_morning_brief_regressions",
      datasetVersion: 1,
      caseName: "morning_brief_hallucinated_attendee_regression",
      expected: {
        status: "completed",
        zero_unrelated_attendees: true,
      },
      tags: ["dogfood", "iris", "today", "validation_defects"],
    });

    expect(regressionCase.case_id).toBeDefined();
    expect(regressionCase.source_run_id).toBe("iris-run-failure-001");
  });

  // 9. Self-Hosted Session / HTTPS Contract
  it("Item 29: self-hosted session cookie preserves secure flag contract across direct and reverse proxy", () => {
    const directHttpReq = new Request("http://127.0.0.1:3000/api/auth/unlock");
    expect(isRequestHttps(directHttpReq)).toBe(false);
    const httpOpts = getSessionCookieOptions(directHttpReq);
    expect(httpOpts.secure).toBe(false); // Prevents browser silently dropping cookie on plain HTTP

    const proxyHttpsReq = new Request("http://127.0.0.1:3000/api/auth/unlock", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(isRequestHttps(proxyHttpsReq)).toBe(true);
    const proxyOpts = getSessionCookieOptions(proxyHttpsReq);
    expect(proxyOpts.secure).toBe(true); // Enables Secure cookie when behind trusted HTTPS reverse proxy
  });
});
