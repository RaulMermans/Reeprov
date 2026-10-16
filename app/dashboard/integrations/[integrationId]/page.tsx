"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { computeDisplayStatus } from "@/lib/integrations/integrationTypes";
import type { ProjectIntegration } from "@/lib/integrations/integrationTypes";
import type { RunSummary } from "@/lib/runs/runTypes";
import type { SavedWorkflowSummary } from "@/lib/workflows/workflowTypes";
import type { IntegrationWorkflowBlueprint as IntegrationWorkflowBlueprintData } from "@/lib/integrations/integrationBlueprintTypes";
import { IntegrationWorkflowBlueprint } from "@/components/proof-layer/IntegrationWorkflowBlueprint";
import { IntegrationHealthSummary } from "@/components/proof-layer/IntegrationHealthSummary";

interface IntegrationReadiness {
  lastRunAt: string | null;
  workflowCount: number;
  workflowMode: "registered_spec" | "inferred";
  registeredWorkflow: SavedWorkflowSummary | null;
  recentIngestErrors: Array<{ at: string; message: string; category?: string }>;
  diagnosticsAvailable: boolean;
}

// ── Snippet generators ────────────────────────────────────────────────────────

function tsSnippet(p: ProjectIntegration): string {
  const wfId = p.defaultWorkflowId ?? `${p.projectId}-workflow`;
  return `// 1. Install @reeprov/client or copy client from examples/integrations/typescript/
// 2. Set environment variables in your project:
//
//   REEPROV_URL=https://<your-reeprov-url>
//   REEPROV_INGEST_KEY=<your-ingest-key>
//   REEPROV_PROJECT_ID=${p.projectId}
//   REEPROV_PROJECT_NAME="${p.projectName}"
//   REEPROV_WORKFLOW_ID=${wfId}
//   REEPROV_ENABLED=true
//
// 3. Wrap your workflow:

import { ReeprovClient } from "@reeprov/client";

const reeprov = new ReeprovClient();

const runId = await reeprov.startRun({
  summary: "Starting ${p.projectName} run",
});

await reeprov.modelCallCompleted(runId, {
  nodeId: "my-agent",
  modelProvider: "anthropic",
  modelName: "claude-sonnet-4-6",
  inputTokens: 1500,
  outputTokens: 300,
  costUsd: 0.002,
  outputSummary: "Agent output here",
});

await reeprov.completeRun(runId, {
  summary: "Run completed successfully",
});`;
}

function pythonSnippet(p: ProjectIntegration): string {
  const wfId = p.defaultWorkflowId ?? `${p.projectId}-workflow`;
  return `# 1. Install reeprov-client or copy client from examples/integrations/python/
# 2. Set environment variables in your project:
#
#   REEPROV_URL=https://<your-reeprov-url>
#   REEPROV_INGEST_KEY=<your-ingest-key>
#   REEPROV_PROJECT_ID=${p.projectId}
#   REEPROV_PROJECT_NAME="${p.projectName}"
#   REEPROV_WORKFLOW_ID=${wfId}
#   REEPROV_ENABLED=true
#
# 3. Wrap your workflow:

from reeprov_client import ReeprovClient

reeprov = ReeprovClient()

run_id = reeprov.start_run(summary="Starting ${p.projectName} run")

reeprov.model_call_completed(
    run_id=run_id,
    node_id="my-agent",
    model_provider="anthropic",
    model_name="claude-sonnet-4-6",
    input_tokens=1500,
    output_tokens=300,
    cost_usd=0.002,
    output_summary="Agent output here",
)

reeprov.complete_run(run_id, summary="Run completed successfully")`;
}

function restSnippet(p: ProjectIntegration): string {
  const wfId = p.defaultWorkflowId ?? `${p.projectId}-workflow`;
  return `# REST API (curl)
# Set these in your shell or CI environment:
#   REEPROV_URL=https://<your-reeprov-url>
#   REEPROV_INGEST_KEY=<your-ingest-key>
#
# 1. Start a run
curl -s -X POST "$REEPROV_URL/api/runs/start" \\
  -H "Content-Type: application/json" \\
  -H "x-reeprov-key: $REEPROV_INGEST_KEY" \\
  -d '{"project_id":"${p.projectId}","project_name":"${p.projectName}","workflow_id":"${wfId}","summary":"Test run"}'

# 2. Append trace events
curl -s -X POST "$REEPROV_URL/api/traces/events" \\
  -H "Content-Type: application/json" \\
  -H "x-reeprov-key: $REEPROV_INGEST_KEY" \\
  -d '{"events":[{"event_id":"<run_id>::node::started","run_id":"<run_id>","workflow_id":"${wfId}","timestamp":"<iso>","event_type":"node_started","status":"running","node_id":"my-agent"}]}'

# 3. Complete the run
curl -s -X POST "$REEPROV_URL/api/runs/complete" \\
  -H "Content-Type: application/json" \\
  -H "x-reeprov-key: $REEPROV_INGEST_KEY" \\
  -d '{"run_id":"<run_id>","summary":"Run completed"}'`;
}

function envBlock(p: ProjectIntegration): string {
  const wfId = p.defaultWorkflowId ?? `${p.projectId}-workflow`;
  return `REEPROV_URL=https://<your-reeprov-deployment-url>
REEPROV_INGEST_KEY=<use-the-REEPROV_INGEST_KEY-from-your-Reeprov-deployment>
REEPROV_PROJECT_ID=${p.projectId}
REEPROV_PROJECT_NAME="${p.projectName}"
REEPROV_WORKFLOW_ID=${wfId}
REEPROV_ENABLED=true`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "receiving_events") return "success";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function readinessLabel(status: string): string {
  if (status === "receiving_events") return "live";
  if (status === "stale") return "disconnected";
  if (status === "error") return "degraded";
  if (status === "configured") return "waiting for first event";
  return status.replace(/_/g, " ");
}

function formatDateTime(iso?: string): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ── Code block with copy ──────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between rounded-t-md border border-slate-200 bg-slate-100 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-500">{lang}</span>
        <button
          onClick={copy}
          type="button"
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-md border border-t-0 border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SnippetTab = "typescript" | "python" | "rest";

export default function IntegrationDetailPage() {
  const { onUnauthorized } = useDashboardAuth();
  const params = useParams();
  const router = useRouter();
  const integrationId = params["integrationId"] as string;

  const [integration, setIntegration] = useState<ProjectIntegration | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([]);
  const [readiness, setReadiness] = useState<IntegrationReadiness | null>(null);
  const [blueprint, setBlueprint] = useState<IntegrationWorkflowBlueprintData | null>(null);
  const [blueprintError, setBlueprintError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snippetTab, setSnippetTab] = useState<SnippetTab>("typescript");
  const [sendingTest, setSendingTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [revealedRawKey, setRevealedRawKey] = useState<string | null>(null);

  useEffect(() => {
    void loadIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId]);

  async function loadIntegration() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (res.status === 404) {
        setError("Integration not found.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Failed to load integration.");
        return;
      }
      const data = await res.json() as {
        integration: ProjectIntegration;
        recentRuns: RunSummary[];
        readiness: IntegrationReadiness;
      };
      setIntegration(data.integration);
      setRecentRuns(data.recentRuns ?? []);
      setReadiness(data.readiness);
      void loadBlueprint();
    } catch {
      setError("Could not connect to Reeprov. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  async function loadBlueprint() {
    setBlueprintError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/blueprint`, {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        setBlueprintError("Failed to load the workflow blueprint.");
        return;
      }
      const data = await res.json() as { blueprint: IntegrationWorkflowBlueprintData };
      setBlueprint(data.blueprint);
    } catch {
      setBlueprintError("Could not load the workflow blueprint.");
    }
  }

  async function sendTestEvent() {
    setSendingTest(true);
    setTestError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/test-event`, {
        method: "POST",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setTestError(data.message ?? "Failed to create test event.");
        return;
      }
      const data = await res.json() as { ok: boolean; redirectTo: string };
      router.push(data.redirectTo);
    } catch {
      setTestError("Could not create test event. Is the dev server running?");
    } finally {
      setSendingTest(false);
    }
  }

  async function generateIngestKey() {
    if (
      integration?.ingestKeyPreview &&
      !confirm("Generate a new scoped key? The current scoped key will stop working immediately.")
    ) {
      return;
    }
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/ingest-key`, {
        method: "POST",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setKeyError(data.message ?? "Failed to generate ingest key.");
        return;
      }
      const data = await res.json() as { integration: ProjectIntegration; rawKey: string };
      setIntegration(data.integration);
      setRevealedRawKey(data.rawKey);
    } catch {
      setKeyError("Could not connect to Reeprov.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function revokeIngestKey() {
    if (!confirm("Revoke the scoped ingest key for this integration? The shared deployment key will still work if configured.")) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`/api/integrations/${integrationId}/ingest-key`, {
        method: "DELETE",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setKeyError(data.message ?? "Failed to revoke ingest key.");
        return;
      }
      const data = await res.json() as { integration: ProjectIntegration };
      setIntegration(data.integration);
      setRevealedRawKey(null);
    } catch {
      setKeyError("Could not connect to Reeprov.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function deleteIntegration() {
    if (!confirm("Delete this integration? This will not delete associated runs or reports.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
        method: "DELETE",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) return;
      router.push("/dashboard/integrations");
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8 text-center text-sm text-slate-500">Loading integration…</Card>
      </main>
    );
  }

  if (error || !integration) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8">
          <p className="text-sm font-medium text-amber-700">{error ?? "Integration not found."}</p>
          <Link href="/dashboard/integrations" className="mt-3 inline-block text-sm text-teal-700 hover:underline">
            ← Back to Integrations
          </Link>
        </Card>
      </main>
    );
  }

  const displayStatus = computeDisplayStatus(integration);
  const snippetLang = snippetTab === "typescript" ? integration.language === "typescript" ? "typescript" : snippetTab : snippetTab;
  void snippetLang;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">

      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard/integrations" className="text-sm text-slate-400 hover:text-slate-700">
              Integrations /
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{integration.projectName}</h1>
            <Badge tone={statusTone(displayStatus)}>{readinessLabel(displayStatus)}</Badge>
          </div>
          {integration.description && (
            <p className="mt-1 text-sm text-slate-500">{integration.description}</p>
          )}
          <p className="mt-1 font-mono text-xs text-slate-400">
            {integration.projectId} · {integration.integrationId}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void sendTestEvent()}
            disabled={sendingTest}
            type="button"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sendingTest ? "Sending…" : "Send test event"}
          </button>
          <button
            onClick={() => void deleteIntegration()}
            disabled={deleting}
            type="button"
            className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </section>

      {testError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {testError}
        </div>
      )}

      {/* Status summary */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-800">Connection Status</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <dt className="text-xs font-medium text-slate-400">Status</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{readinessLabel(displayStatus)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Mode</dt>
            <dd className="mt-0.5 text-slate-600">{integration.mode.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Language</dt>
            <dd className="mt-0.5 text-slate-600">{integration.language ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Total runs</dt>
            <dd className="mt-0.5 text-slate-600">{integration.runCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Last event</dt>
            <dd className="mt-0.5 text-slate-600">{formatDateTime(integration.lastEventAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Last run received</dt>
            <dd className="mt-0.5 text-slate-600">{formatDateTime(readiness?.lastRunAt ?? undefined)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Workflows</dt>
            <dd className="mt-0.5 text-slate-600">{readiness?.workflowCount ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Graph structure</dt>
            <dd className="mt-0.5 text-slate-600">
              {readiness?.workflowMode === "registered_spec" ? "Registered WorkflowSpec" : "Inferred from observed stages"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Last run status</dt>
            <dd className="mt-0.5 text-slate-600">{integration.lastRunStatus ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-400">Default workflow</dt>
            <dd className="mt-0.5 font-mono text-xs text-slate-600">{integration.defaultWorkflowId ?? "—"}</dd>
          </div>
          {integration.repositoryUrl && (
            <div className="col-span-2">
              <dt className="text-xs font-medium text-slate-400">Repository</dt>
              <dd className="mt-0.5 truncate text-xs text-teal-700">
                <a href={integration.repositoryUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {integration.repositoryUrl}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Workflow Blueprint — aggregate, read-only map across recent runs. */}
      {blueprintError ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {blueprintError}
        </div>
      ) : blueprint ? (
        <>
          <IntegrationHealthSummary health={blueprint.healthSummary} />
          <IntegrationWorkflowBlueprint blueprint={blueprint} />
        </>
      ) : (
        <Card className="p-8 text-center text-sm text-slate-500">Loading workflow blueprint…</Card>
      )}

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Ingest diagnostics</h2>
        <p className="mb-3 text-xs text-slate-500">Diagnostics are redacted and retained temporarily.</p>
        {readiness?.recentIngestErrors.length ? (
          <ul className="space-y-2 text-xs text-amber-800">
            {readiness.recentIngestErrors.map((item) => (
              <li key={`${item.at}-${item.message}`} className="rounded-md bg-amber-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">{formatDateTime(item.at)}</span>
                  {item.category && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                      {item.category.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
                <div className="mt-1">{item.message}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">
            {readiness?.diagnosticsAvailable
              ? "No recent ingest errors recorded."
              : "Ingest errors are returned to the sending client but diagnostics could not be loaded. Check the HTTP response and sender logs."}
          </p>
        )}
      </Card>

      {/* Scoped ingest key */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Scoped Ingest Key</h2>
        <p className="mb-4 text-xs text-slate-500">
          A scoped key authenticates ingestion for this project only, instead of the shared deployment-wide
          <code className="mx-1 font-mono">REEPROV_INGEST_KEY</code>. The shared key keeps working either way —
          scoped keys are opt-in per integration.
        </p>

        {revealedRawKey && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-2 text-xs font-medium text-amber-800">
              Copy this key now — it will not be shown again.
            </p>
            <CodeBlock code={revealedRawKey} lang="REEPROV_INGEST_KEY" />
            <button
              type="button"
              onClick={() => setRevealedRawKey(null)}
              className="mt-2 text-xs font-medium text-amber-800 hover:underline"
            >
              I&#39;ve saved it — hide this key
            </button>
          </div>
        )}

        {keyError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {keyError}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-100 px-4 py-3">
          <div>
            <p className="text-xs font-medium text-slate-400">Current scoped key</p>
            <p className="mt-0.5 font-mono text-sm text-slate-800">
              {integration.ingestKeyPreview ?? "No scoped key — using the shared deployment key"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void generateIngestKey()}
              disabled={keyBusy}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {keyBusy ? "Working…" : integration.ingestKeyPreview ? "Rotate key" : "Generate scoped key"}
            </button>
            {integration.ingestKeyPreview && (
              <button
                type="button"
                onClick={() => void revokeIngestKey()}
                disabled={keyBusy}
                className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Setup instructions */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Environment Variables</h2>
        <p className="mb-4 text-xs text-slate-500">
          Copy these into your external project&#39;s environment. Setting environment variables alone does not send events
          — your project must also import and call the Reeprov client/adapter.
        </p>
        <CodeBlock code={envBlock(integration)} lang="env" />
        <p className="mt-3 text-xs text-slate-500">
          <strong>REEPROV_INGEST_KEY</strong> can be either the shared deployment-wide key or a scoped key generated
          above for this integration. It is separate from the dashboard access key.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">How workflow structure is chosen</h2>
        <p className="text-xs leading-5 text-slate-600">
          A registered WorkflowSpec is the declared contract for node types, order, and edges. When no matching spec exists,
          Reeprov infers the canvas from observed <code className="font-mono">node_id</code> values and event order. Both modes
          use the same generic graph engine; registering a spec adds expected-but-not-observed stages and declared connections.
        </p>
      </Card>

      {/* Language snippets */}
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-800">Integration Snippet</h2>
        <p className="mb-4 text-xs text-slate-500">
          Copy the client file from <code className="font-mono">examples/integrations/</code> into your project,
          then wrap your AI workflow with the calls below.
        </p>

        <div className="mb-4 flex gap-1 border-b border-slate-100">
          {(["typescript", "python", "rest"] as SnippetTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setSnippetTab(tab)}
              className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition ${
                snippetTab === tab
                  ? "border-b-2 border-teal-500 text-teal-700"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab === "typescript" ? "TypeScript" : tab === "python" ? "Python" : "REST (curl)"}
            </button>
          ))}
        </div>

        {snippetTab === "typescript" && <CodeBlock code={tsSnippet(integration)} lang="TypeScript" />}
        {snippetTab === "python" && <CodeBlock code={pythonSnippet(integration)} lang="Python" />}
        {snippetTab === "rest" && <CodeBlock code={restSnippet(integration)} lang="Shell" />}
      </Card>

      {/* Recent runs */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Recent Runs</h2>
          <Link
            href={`/dashboard/runs?projectId=${integration.projectId}`}
            className="text-xs text-teal-700 hover:underline"
          >
            View all runs →
          </Link>
        </div>

        {recentRuns.length === 0 ? (
          <p className="text-sm text-slate-500">
            No runs yet for this project. Send a test event to confirm the connection, or run your AI project with the adapter installed.
          </p>
        ) : (
          <div className="grid gap-2">
            {recentRuns.map((run) => (
              <Link
                key={run.run_id}
                href={`/dashboard/runs/${run.run_id}`}
                className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm hover:border-teal-200 hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-xs text-slate-400">{run.run_id}</span>
                  <span className="truncate text-xs text-slate-500">{run.summary}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  <span>{formatDuration(run.total_duration_ms)}</span>
                  <Badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : run.status === "degraded" ? "warning" : "neutral"}>
                    {run.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Troubleshooting */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Troubleshooting</h2>
        <div className="space-y-3 text-xs text-slate-600">
          <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800">
            <strong>Environment variables alone do not send events.</strong> Your project must import and call
            the Reeprov client/adapter. Setting <code className="font-mono">REEPROV_ENABLED=true</code> enables
            the adapter; the adapter then calls the ingest API when your workflow runs.
          </p>
          <p><strong>If no runs appear after running your project:</strong></p>
          <ul className="ml-4 list-disc space-y-1">
            <li>Check that <code className="font-mono">REEPROV_URL</code> points to your running Reeprov instance.</li>
            <li>Check that <code className="font-mono">REEPROV_INGEST_KEY</code> matches the value in your Reeprov deployment.</li>
            <li>Check that <code className="font-mono">REEPROV_ENABLED=true</code> is set in your project environment.</li>
            <li>Check your external project logs for <code className="font-mono">401</code>, <code className="font-mono">404</code>, or <code className="font-mono">500</code> errors from Reeprov.</li>
            <li>Redeploy or restart your external project after setting environment variables.</li>
            <li>Confirm the Reeprov client/adapter is imported and <code className="font-mono">startRun()</code> is called before other events.</li>
          </ul>
          <p>
            Use <strong>Send test event</strong> above to confirm the Reeprov side is working.
            That button uses your dashboard key (not the ingest key) and creates a test run server-side.
          </p>
        </div>
      </Card>

    </main>
  );
}
