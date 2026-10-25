import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sanitizeString, sanitizePayload } from "../redaction";
import { normalizeBoundary } from "../normalizeBoundary";
import { captureToolInvocation } from "../adapters/toolCapture";
import { captureModelInvocation } from "../adapters/modelCapture";
import { captureRetrievalOperation } from "../adapters/retrievalCapture";
import { captureMemoryOperation } from "../adapters/memoryCapture";
import { buildContextSnapshot } from "../contextSnapshotBuilder";
import { hashPayload } from "../hashing";
import { saveCanonicalRun } from "../persistence";
import { runArtifactSchema } from "../../contracts/runArtifact";
import fs from "node:fs";
import path from "node:path";

describe("Telemetry Minimization & Secret Redaction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("omits narrative content from every STRUCTURE_ONLY sidecar", async () => {
    const narrative = "private customer narrative for case C-42";
    const policy = { contentMode: "STRUCTURE_ONLY" as const };
    const tool = await captureToolInvocation({
      runId: "s12-tool", toolName: "lookup", arguments: { query: narrative },
      output: { answer: narrative }, startedAt: "2026-01-01T00:00:00.000Z",
      metadata: { note: narrative },
    }, policy);
    const model = await captureModelInvocation({
      runId: "s12-model", model: "local", provider: "local", prompt: narrative,
      response: narrative, startedAt: "2026-01-01T00:00:00.000Z",
      metadata: { note: narrative },
    }, policy);
    const retrieval = await captureRetrievalOperation({
      runId: "s12-retrieval", serviceName: "search", query: narrative,
      results: [{ documentId: "doc-1", content: narrative, metadata: { note: narrative } }],
      startedAt: "2026-01-01T00:00:00.000Z",
    }, policy);
    const memory = await captureMemoryOperation({
      runId: "s12-memory", provider: "memory", operationType: "read",
      category: "episodic", query: narrative,
      timestamps: { operationAt: "2026-01-01T00:00:00.000Z" },
      outcome: "success", details: { note: narrative },
    }, policy);
    const context = await buildContextSnapshot({
      items: [{ sourceType: "user_input", content: narrative, metadata: { note: narrative } }],
      metadata: { note: narrative }, policyOverrides: policy,
    });
    for (const record of [tool, model, retrieval, memory, context]) {
      expect(JSON.stringify(record)).not.toContain(narrative);
    }
    expect(tool.toolInvocation.input).toBeUndefined();
    expect(model.modelInvocation.response_summary).toBeUndefined();
    expect(retrieval.retrievalOperation.query).toBe("");
    expect(memory.memoryOperation.details).toBeUndefined();
    expect(context.items[0]?.content).toBeUndefined();
  });

  it("rejects an unsafe canonical run before either persistence backend writes", async () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(),
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"), "utf8"));
    const artifact = runArtifactSchema.parse(fixture);
    artifact.identity.run_id = "s12-unsafe-persistence";
    artifact.execution.summary = "credential sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    await expect(saveCanonicalRun(artifact)).rejects.toThrow("PRIVACY_VALIDATION_FAILED");
  });

  describe("Secret Patterns Detection", () => {
    it("redacts OpenAI API keys", () => {
      const text = "Using key sk-abcdef1234567890abcdef1234567890 in client";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Using key [REDACTED_OPENAI_KEY] in client");
      expect(sanitized).not.toContain("sk-abcdef");
    });

    it("redacts Anthropic API keys", () => {
      const text = "ANTHROPIC_KEY=sk-ant-api03-abcdef1234567890abcdef12345";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("ANTHROPIC_KEY=[REDACTED_ANTHROPIC_KEY]");
      expect(sanitized).not.toContain("sk-ant-");
    });

    it("redacts GitHub personal access tokens", () => {
      const text1 = "ghp_1234567890abcdef1234567890abcdef1234";
      const text2 = "github_pat_11AAAAAAA01234567890abcdef1234567890abcdef1234567890";
      expect(sanitizeString(text1).sanitized).toBe("[REDACTED_GITHUB_TOKEN]");
      expect(sanitizeString(text2).sanitized).toBe("[REDACTED_GITHUB_TOKEN]");
    });

    it("redacts AWS Access Key IDs", () => {
      const text = "Connect with AKIAIOSFODNN7EXAMPLE to S3";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Connect with [REDACTED_AWS_KEY] to S3");
    });

    it("redacts Bearer tokens in headers or strings", () => {
      const text = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
      const { sanitized, redacted } = sanitizeString(text);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("Authorization: Bearer [REDACTED_BEARER_TOKEN]");
    });

    it("redacts PEM private key blocks", () => {
      const pem =
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y...\n-----END RSA PRIVATE KEY-----";
      const { sanitized, redacted } = sanitizeString(pem);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("[REDACTED_PRIVATE_KEY]");
    });

    it("redacts credentials in database URLs", () => {
      const url = "postgres://admin:super_secret_pw@db.production.internal:5432/main";
      const { sanitized, redacted } = sanitizeString(url);
      expect(redacted).toBe(true);
      expect(sanitized).toBe("postgres://admin:[REDACTED_CREDENTIALS]@db.production.internal:5432/main");
      expect(sanitized).not.toContain("super_secret_pw");
    });

    it("redacts secret query parameters in URLs", () => {
      const url = "https://api.provider.com/v1/data?api_key=my_secret_token_123&format=json";
      const { sanitized, redacted } = sanitizeString(url);
      expect(redacted).toBe(true);
      expect(sanitized).toContain("api_key=[REDACTED_QUERY_PARAM]");
      expect(sanitized).not.toContain("my_secret_token_123");
    });

    it("redacts configured environment variable secrets", () => {
      process.env["AGENTPULSE_INGEST_KEY"] = "super-secret-ingest-key-999";
      const text = "Client passed key super-secret-ingest-key-999 to server";
      const { sanitized, redacted } = sanitizeString(text, [], true);
      expect(redacted).toBe(true);
      expect(sanitized).toContain("[REDACTED_ENV_SECRET]");
      expect(sanitized).not.toContain("super-secret-ingest-key-999");
    });
  });

  describe("Object & Payload Sanitization Pipeline", () => {
    it("redacts secrets from the entire canonical boundary, including fallback summaries", async () => {
      const secret = ["sk", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"].join("-");
      const boundary = await normalizeBoundary({
        runId: "run-redaction",
        boundaryType: "tool_call",
        name: `lookup ${secret}`,
        input: `input ${secret}`,
        inputSummary: `summary ${secret}`,
        output: `output ${secret}`,
        outputSummary: `summary ${secret}`,
        error: { message: `error ${secret}`, details: { api_key: secret } },
        metadata: { note: secret, authorization: secret },
        dependencyIdentity: `service:${secret}`,
      });
      const fallback = await normalizeBoundary({
        runId: "run-redaction-fallback",
        boundaryType: "tool_call",
        name: "lookup",
        input: `input ${secret}`,
        output: `output ${secret}`,
        error: { message: `error ${secret}` },
      });

      expect(JSON.stringify(boundary)).not.toContain(secret);
      expect(JSON.stringify(fallback)).not.toContain(secret);
      expect(boundary.redaction_status).toBe("partially_redacted");
      expect(boundary.input.hash).toBeDefined();
      expect(boundary.content_hashes?.input_hash).toBe(boundary.input.hash);
    });

    it("does not copy raw summaries into STRUCTURE_ONLY boundaries", async () => {
      const boundary = await normalizeBoundary({
        runId: "run-structure-only",
        boundaryType: "tool_call",
        name: "lookup",
        input: "private customer narrative",
        inputSummary: "private customer narrative",
        output: "private reply",
        outputSummary: "private reply",
      }, { contentMode: "STRUCTURE_ONLY" });

      expect(boundary.input.summary).toBeUndefined();
      expect(boundary.output?.summary).toBeUndefined();
      expect(boundary.input.content).toBeUndefined();
      expect(boundary.output?.content).toBeUndefined();
    });

    it("redacts model and tool sidecar records before canonical export", async () => {
      const secret = ["sk", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"].join("-");
      const tool = await captureToolInvocation({
        runId: "run-tool-redaction",
        toolName: "lookup",
        arguments: { authorization: secret, query: `find ${secret}` },
        output: { answer: secret },
        error: { message: `error ${secret}` },
        startedAt: "2026-01-01T00:00:00.000Z",
        metadata: { note: secret },
      });
      const model = await captureModelInvocation({
        runId: "run-model-redaction",
        model: "local-model",
        provider: "local",
        prompt: `prompt ${secret}`,
        response: `response ${secret}`,
        startedAt: "2026-01-01T00:00:00.000Z",
        metadata: { note: secret },
      });

      expect(JSON.stringify(tool)).not.toContain(secret);
      expect(JSON.stringify(model)).not.toContain(secret);
      expect(model.modelInvocation.prompt_tokens).toBeTypeOf("number");
    });

    it("redacts retrieval, memory, and context sidecars without breaking content hashes", async () => {
      const secret = ["sk", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"].join("-");
      const retrieval = await captureRetrievalOperation({
        runId: "run-retrieval-redaction",
        serviceName: "search",
        query: `query ${secret}`,
        results: [{ documentId: "doc-1", content: `content ${secret}`, metadata: { note: secret } }],
        startedAt: "2026-01-01T00:00:00.000Z",
      });
      const memory = await captureMemoryOperation({
        runId: "run-memory-redaction",
        provider: "memory",
        operationType: "read",
        category: "episodic",
        query: `query ${secret}`,
        timestamps: { operationAt: "2026-01-01T00:00:00.000Z" },
        outcome: "success",
        details: { note: secret },
      });
      const context = await buildContextSnapshot({
        items: [{ sourceType: "user_input", content: `prompt ${secret}`, metadata: { note: secret } }],
        metadata: { note: secret },
      });

      expect(JSON.stringify(retrieval)).not.toContain(secret);
      expect(JSON.stringify(memory)).not.toContain(secret);
      expect(JSON.stringify(context)).not.toContain(secret);
      const item = retrieval.retrievalOperation.results[0]!;
      expect(item.metadata?.["content_hash"]).toBe(hashPayload(item.content));
    });
    it("redacts sensitive object keys recursively", () => {
      const payload = {
        user: "alice",
        password: "PlaintextPassword123!",
        nested: {
          token: "secret-token-xyz",
          apiKey: "sk-abcdef1234567890abcdef1234567890",
          validField: "keep-me",
        },
      };

      const result = sanitizePayload(payload);
      expect(result.redacted).toBe(true);
      expect(result.fields_redacted).toContain("password");
      expect(result.fields_redacted).toContain("token");
      expect(result.fields_redacted).toContain("apiKey");

      const val = result.value as typeof payload;
      expect(val.password).toBe("[REDACTED_SECRET]");
      expect(val.nested.token).toBe("[REDACTED_SECRET]");
      expect(val.nested.apiKey).toBe("[REDACTED_SECRET]");
      expect(val.nested.validField).toBe("keep-me");
    });

    it("redacts sensitive HTTP headers in payloads", () => {
      const payload = {
        headers: {
          "authorization": "Bearer secret-token-header",
          "cookie": "session_id=12345",
          "content-type": "application/json",
          "x-api-key": "some-key",
        },
      };

      const result = sanitizePayload(payload);
      expect(result.redacted).toBe(true);
      const val = result.value as typeof payload;
      expect(val.headers.authorization).toBe("[REDACTED_SECRET]");
      expect(val.headers.cookie).toBe("[REDACTED_SECRET]");
      expect(val.headers["x-api-key"]).toBe("[REDACTED_SECRET]");
      expect(val.headers["content-type"]).toBe("application/json");
    });

    it("supports STRUCTURE_ONLY capture mode (omits payload content while calculating hashes)", () => {
      const payload = {
        prompt: "Classify this sensitive patient record: diagnosis XYZ",
        history: ["turn 1", "turn 2"],
        meta: { count: 2 },
      };

      const result = sanitizePayload(payload, { modeOverride: "STRUCTURE_ONLY" });
      expect(result.redacted).toBe(true);
      expect(result.content_status).toBe("fully_redacted");
      expect(result.original_hash).toBeDefined();
      expect(result.persisted_hash).toBeDefined();

      const structure = result.value as Record<string, unknown>;
      expect(structure["type"]).toBe("object");
      expect(structure).not.toHaveProperty("prompt", "Classify this sensitive patient record: diagnosis XYZ");
    });

    it("FULL_CONTENT mode STILL scrubs mandatory secrets", () => {
      const payload = {
        prompt: "Using OpenAI key sk-abcdef1234567890abcdef1234567890 to query",
        password: "mypassword123",
        safeData: "This is completely safe",
      };

      const result = sanitizePayload(payload, { modeOverride: "FULL_CONTENT" });
      expect(result.redacted).toBe(true);

      const val = result.value as typeof payload;
      expect(val.safeData).toBe("This is completely safe");
      // Mandatory secret redaction must still happen!
      expect(val.prompt).toBe("Using OpenAI key [REDACTED_OPENAI_KEY] to query");
      expect(val.password).toBe("[REDACTED_SECRET]");
    });
  });
});
