import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedRun } from "@/lib/runs/runTypes";

type MockRow = Record<string, unknown>;
type MockSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<MockRow[]>;
  unsafe(query: string): Promise<MockRow[]>;
};

const originalAccessKey = process.env["AGENTPULSE_ACCESS_KEY"];

beforeEach(() => {
  process.env["AGENTPULSE_ACCESS_KEY"] = "test-access-key";
});

afterEach(() => {
  if (originalAccessKey === undefined) delete process.env["AGENTPULSE_ACCESS_KEY"];
  else process.env["AGENTPULSE_ACCESS_KEY"] = originalAccessKey;
  vi.doUnmock("@/lib/db/client");
  vi.doUnmock("@/lib/db/migrate");
  vi.doUnmock("@/lib/db/getStores");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("pgRunStore.getRun normalization", () => {
  it("returns render-safe metadata objects, arrays, timestamps, and numeric fields", async () => {
    mockPostgresRunRows();
    const { pgRunStore } = await import("@/lib/runs/pgRunStore");

    const saved = await pgRunStore.getRun("test-run_mq0mgb31_e17b");

    expect(saved).not.toBeNull();
    expectRenderSafeRunDetail(saved!);
    expect(saved!.traceEvents[0]!.metadata).toEqual({
      model_provider: "anthropic",
      model_name: "claude-haiku-4-5",
    });
    expect(typeof saved!.traceEvents[0]!.metadata).toBe("object");
    expect(typeof saved!.traceEvents[0]!.metadata).not.toBe("string");
    expect(saved!.traceEvents[0]!.duration_ms).toBe(120);
    expect(saved!.traceEvents[0]!.cost_usd).toBe(0.012);
    expect(saved!.toolCalls[0]!.duration_ms).toBe(90);
    expect(saved!.artifactRefs).toEqual(["artifact-1"]);
  });

  it("returns eval result findings as an array, not a JSON string", async () => {
    mockPostgresRunRows();
    const { pgRunStore } = await import("@/lib/runs/pgRunStore");

    const saved = await pgRunStore.getRun("test-run_mq0mgb31_e17b");

    expect(saved?.evalResults[0]?.findings).toEqual([]);
    expect(Array.isArray(saved?.evalResults[0]?.findings)).toBe(true);
    expect(saved?.evalResults[0]?.findings).not.toBe("[]");
    expect((saved?.evalResults[0] as { metadata?: unknown } | undefined)?.metadata).toEqual({
      judge: "static",
    });
  });

  it("falls back safely when JSON parsing fails", async () => {
    expect.assertions(4);
    mockPostgresRunRows({
      traceMetadata: "{not json",
      findings: "{not json",
      evalMetadata: "{not json",
      artifactRefs: "{not json",
    });
    const { pgRunStore } = await import("@/lib/runs/pgRunStore");

    const saved = await pgRunStore.getRun("test-run_mq0mgb31_e17b");

    expect(saved?.traceEvents[0]?.metadata).toBeUndefined();
    expect(saved?.evalResults[0]?.findings).toEqual([]);
    expect((saved?.evalResults[0] as { metadata?: unknown } | undefined)?.metadata).toBeUndefined();
    expect(saved?.artifactRefs).toEqual([]);
  });
});

describe("GET /api/runs/[runId] Postgres shape", () => {
  it("returns traceEvents and evalResults in the same render-safe shape as the file store", async () => {
    mockPostgresRunRows();
    const { pgRunStore } = await import("@/lib/runs/pgRunStore");
    const normalizedRun = await pgRunStore.getRun("test-run_mq0mgb31_e17b");
    vi.doMock("@/lib/db/getStores", () => ({
      getRunStore: () => ({
        getRun: async () => normalizedRun,
      }),
    }));
    const { GET } = await import("../../../app/api/runs/[runId]/route");

    const res = await GET(
      new Request("http://localhost/api/runs/test-run_mq0mgb31_e17b", {
        headers: { "x-agentpulse-key": "test-access-key" },
      }),
      { params: Promise.resolve({ runId: "test-run_mq0mgb31_e17b" }) },
    );
    const body = await res.json() as SavedRun & { derivedSummary?: unknown };

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "artifactRefs",
      "createdAt",
      "derivedSummary",
      "evalResults",
      "runRecord",
      "toolCalls",
      "traceEvents",
      "updatedAt",
    ]);
    expectRenderSafeRunDetail(body);
    expect(body.traceEvents[0]!.metadata).toEqual({
      model_provider: "anthropic",
      model_name: "claude-haiku-4-5",
    });
    expect(body.evalResults[0]!.findings).toEqual([]);
  });
});

function expectRenderSafeRunDetail(saved: SavedRun): void {
  expect(Array.isArray(saved.traceEvents)).toBe(true);
  expect(Array.isArray(saved.toolCalls)).toBe(true);
  expect(Array.isArray(saved.evalResults)).toBe(true);
  expect(Array.isArray(saved.artifactRefs)).toBe(true);
  expect(Array.isArray(saved.runRecord.artifact_refs)).toBe(true);

  expect(typeof saved.runRecord.started_at).toBe("string");
  expect(Number.isNaN(Date.parse(saved.runRecord.started_at))).toBe(false);
  expect(typeof saved.createdAt).toBe("string");
  expect(typeof saved.updatedAt).toBe("string");

  expect(typeof saved.runRecord.model_calls_count).toBe("number");
  expect(typeof saved.runRecord.tool_calls_count).toBe("number");
  expect(typeof saved.runRecord.evals_passed).toBe("number");
  expect(typeof saved.runRecord.evals_failed).toBe("number");
  expect(typeof saved.runRecord.total_cost_usd).toBe("number");
  expect(typeof saved.runRecord.total_duration_ms).toBe("number");

  for (const event of saved.traceEvents) {
    expect(typeof event.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    expect(typeof event.duration_ms).toBe("number");
    expect(typeof event.cost_usd).toBe("number");
    expect(typeof event.metadata).toBe("object");
    expect(Array.isArray(event.metadata)).toBe(false);
    expect(typeof event.metadata).not.toBe("string");
  }

  for (const toolCall of saved.toolCalls as Array<{ duration_ms?: unknown; metadata?: unknown; started_at?: unknown }>) {
    expect(typeof toolCall.started_at).toBe("string");
    expect(typeof toolCall.duration_ms).toBe("number");
    expect(typeof toolCall.metadata).toBe("object");
    expect(Array.isArray(toolCall.metadata)).toBe(false);
    expect(typeof toolCall.metadata).not.toBe("string");
  }

  for (const evalResult of saved.evalResults as Array<{ findings?: unknown; metadata?: unknown; score?: unknown }>) {
    expect(Array.isArray(evalResult.findings)).toBe(true);
    expect(evalResult.findings).not.toBe("[]");
    expect(typeof evalResult.score).toBe("number");
    expect(typeof evalResult.metadata).toBe("object");
    expect(Array.isArray(evalResult.metadata)).toBe(false);
    expect(typeof evalResult.metadata).not.toBe("string");
  }
}

function mockPostgresRunRows(overrides: {
  traceMetadata?: unknown;
  artifactMetadata?: unknown;
  findings?: unknown;
  evalMetadata?: unknown;
  toolMetadata?: unknown;
  artifactRefs?: unknown;
} = {}): void {
  const now = "2026-06-05T10:00:00.000Z";
  const runRow: MockRow = {
    run_id: "test-run_mq0mgb31_e17b",
    workflow_id: "test-workflow",
    project_id: "test-project",
    project_name: "Test Project",
    status: "completed",
    summary: "Render-safe test run.",
    started_at: now,
    completed_at: "2026-06-05T10:01:00.000Z",
    total_cost_usd: "0.123456",
    total_duration_ms: "60000",
    model_calls_count: "1",
    tool_calls_count: "1",
    evals_passed: "1",
    evals_failed: "0",
    approval_status: null,
    artifact_refs: overrides.artifactRefs ?? '["artifact-1"]',
    created_at: now,
    updated_at: "2026-06-05T10:01:00.000Z",
  };
  const eventRows: MockRow[] = [
    {
      event_id: "evt-model",
      run_id: "test-run_mq0mgb31_e17b",
      workflow_id: "test-workflow",
      event_type: "model_call_completed",
      status: "completed",
      node_id: "llm-1",
      timestamp: "2026-06-05T10:00:10.000Z",
      duration_ms: "120",
      cost_usd: "0.012",
      input_summary: "Input.",
      output_summary: "Output.",
      metadata: overrides.traceMetadata ?? "{\"model_provider\":\"anthropic\",\"model_name\":\"claude-haiku-4-5\"}",
    },
    {
      event_id: "evt-artifact",
      run_id: "test-run_mq0mgb31_e17b",
      workflow_id: "test-workflow",
      event_type: "artifact_created",
      status: "completed",
      node_id: "artifact-1",
      timestamp: "2026-06-05T10:00:20.000Z",
      duration_ms: "1",
      cost_usd: "0",
      input_summary: null,
      output_summary: "Artifact created.",
      metadata: overrides.artifactMetadata ?? "{\"artifact_ref\":\"artifact-1\",\"artifact_type\":\"json\"}",
    },
  ];
  const toolRows: MockRow[] = [
    {
      tool_call_id: "tool-1",
      run_id: "test-run_mq0mgb31_e17b",
      node_id: "tool-node",
      tool_name: "fetch_url",
      permission_class: "read_only",
      input_summary: "Fetch input.",
      output_summary: "Fetch output.",
      status: "completed",
      error: null,
      started_at: "2026-06-05T10:00:15.000Z",
      completed_at: "2026-06-05T10:00:16.000Z",
      duration_ms: "90",
      metadata: overrides.toolMetadata ?? "{\"source\":\"trace\"}",
    },
  ];
  const evalRows: MockRow[] = [
    {
      eval_id: "eval-1",
      run_id: "test-run_mq0mgb31_e17b",
      node_id: "llm-1",
      name: "Output quality",
      type: "output_quality",
      score: "0.9700",
      passed: true,
      severity: "info",
      findings: overrides.findings ?? "[]",
      recommendation: null,
      metadata: overrides.evalMetadata ?? "{\"judge\":\"static\"}",
    },
  ];

  const sql = (async (strings: TemplateStringsArray): Promise<MockRow[]> => {
    const query = strings.join("?");
    if (query.includes("FROM ap_runs WHERE run_id")) return [runRow];
    if (query.includes("FROM ap_trace_events")) return eventRows;
    if (query.includes("FROM ap_tool_calls")) return toolRows;
    if (query.includes("FROM ap_eval_results")) return evalRows;
    return [];
  }) as MockSql;
  sql.unsafe = async () => [];

  vi.doMock("@/lib/db/client", () => ({ getDb: () => sql }));
  vi.doMock("@/lib/db/migrate", () => ({ ensureSchema: vi.fn(async () => {}) }));
}
