"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import type { SavedWorkflowSpec } from "@/lib/workflows/workflowTypes";
import type { RunSummary } from "@/lib/runs/runTypes";

function statusTone(s: string): "success" | "warning" | "neutral" | "danger" {
  if (s === "active") return "success";
  if (s === "needs_review") return "warning";
  if (s === "draft") return "neutral";
  if (s === "archived") return "danger";
  return "neutral";
}

function confidenceTone(c: string): "success" | "warning" | "neutral" {
  if (c === "high") return "success";
  if (c === "medium") return "warning";
  return "neutral";
}

function sourceTone(source: string): "success" | "warning" | "neutral" | "info" {
  if (source === "scan_reconstruction") return "info";
  if (source === "manual") return "warning";
  if (source === "example") return "neutral";
  return "neutral";
}

function nodeTone(type: string): "success" | "warning" | "neutral" | "info" | "danger" {
  if (type === "llm" || type === "agent") return "info";
  if (type === "tool") return "warning";
  if (type === "evaluator") return "success";
  if (type === "approval") return "danger";
  if (type === "trigger") return "neutral";
  return "neutral";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RegistryWorkflowDetailPage() {
  const params = useParams<{ registryId: string }>();
  const registryId = params.registryId;
  const { onUnauthorized } = useDashboardAuth();
  const router = useRouter();

  const [workflow, setWorkflow] = useState<SavedWorkflowSpec | null>(null);
  const [relatedRuns, setRelatedRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [copiedSpec, setCopiedSpec] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!registryId) return;
    void loadWorkflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryId]);

  async function loadWorkflow() {
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const res = await fetch(`/api/workflows/${registryId}`, {
        headers: mergeAuthHeaders(),
      });

      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Failed to load workflow.");
        return;
      }

      const data = await res.json() as SavedWorkflowSpec;
      setWorkflow(data);

      // Load related runs.
      try {
        const runsRes = await fetch(
          `/api/runs?workflowId=${encodeURIComponent(data.workflowId)}&limit=5`,
          { headers: mergeAuthHeaders() },
        );
        if (runsRes.ok) {
          const runsData = await runsRes.json() as { runs: RunSummary[] };
          setRelatedRuns(runsData.runs ?? []);
        }
      } catch {
        // related runs are optional
      }
    } catch {
      setError("Could not connect to Reeprov API.");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(status: string) {
    if (!workflow) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/workflows/${registryId}`, {
        method: "PATCH",
        headers: mergeAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status }),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (res.ok) {
        const data = await res.json() as { workflow: SavedWorkflowSpec };
        setWorkflow(data.workflow);
      }
    } catch {
      // silently fail
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function deleteWorkflow() {
    if (!confirm("Delete this workflow from the registry? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workflows/${registryId}`, {
        method: "DELETE",
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (res.ok) {
        router.push("/dashboard/workflows");
      }
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  }

  async function copySpec() {
    if (!workflow) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(workflow.spec, null, 2));
      setCopiedSpec(true);
      setTimeout(() => setCopiedSpec(false), 1500);
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8 text-sm text-slate-500">Loading workflow…</Card>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumb registryId={registryId} />
        <Card className="p-8">
          <p className="text-sm font-medium text-slate-700">Workflow not found.</p>
          <p className="mt-2 text-xs text-slate-500">Registry entry <code className="font-mono">{registryId}</code> was not found.</p>
          <Link href="/dashboard/workflows" className="mt-4 inline-block text-sm text-teal-700 hover:underline">
            ← Back to Workflows
          </Link>
        </Card>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-8">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </Card>
      </main>
    );
  }

  if (!workflow) return null;

  const missingLinks = (workflow.missingLinks ?? []) as Array<{ type: string; targetLabel: string; recommendation: string; severity: string }>;

  return (
    <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumb registryId={registryId} workflowName={workflow.name} />

      {/* ── Header ── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-950">{workflow.name}</h1>
              <Badge tone={statusTone(workflow.status)}>{workflow.status}</Badge>
              <Badge tone={confidenceTone(workflow.confidence)}>{workflow.confidence}</Badge>
              <Badge tone={sourceTone(workflow.source)}>{workflow.source.replace(/_/g, " ")}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">{workflow.projectName}</p>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{workflow.workflowId}</p>
            {workflow.description ? (
              <p className="mt-2 max-w-2xl text-sm text-slate-600">{workflow.description}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {workflow.sourceReportId ? (
              <Link
                href={`/dashboard/reports/${workflow.sourceReportId}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-300"
              >
                Source report ↗
              </Link>
            ) : null}
          </div>
        </div>

        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="Registry ID" value={workflow.registryId} mono />
          <MetaItem label="Architecture" value={workflow.architectureType.replace(/_/g, " ")} />
          <MetaItem label="Version" value={workflow.version} />
          <MetaItem label="Created" value={formatDate(workflow.createdAt)} />
        </dl>
      </Card>

      {/* ── Spec Summary ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Nodes" value={workflow.spec.nodes.length} />
        <MetricCard label="Edges" value={workflow.spec.edges?.length ?? 0} />
        <MetricCard label="Tools" value={workflow.spec.allowed_tools?.length ?? 0} />
        <MetricCard label="Evals" value={workflow.spec.evals?.length ?? 0} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Workflow Graph / Node List ── */}
        <div className="lg:col-span-2">
          <Card className="p-5">
            <h2 className="text-lg font-semibold text-slate-950">Workflow Nodes</h2>
            {workflow.spec.nodes.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No nodes defined in this spec.</p>
            ) : (
              <div className="mt-4 grid gap-2">
                {workflow.spec.nodes.map((node, i) => (
                  <div key={node.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">{i + 1}</span>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{node.label}</p>
                          <p className="font-mono text-xs text-slate-400">{node.id}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={nodeTone(node.type)}>{node.type}</Badge>
                        {node.model_provider ? <Badge tone="neutral">{node.model_provider}</Badge> : null}
                        {node.permission_class ? <Badge tone="warning">{node.permission_class.replace(/_/g, " ")}</Badge> : null}
                      </div>
                    </div>
                    {node.allowed_tools && node.allowed_tools.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {node.allowed_tools.map((t) => (
                          <span key={t} className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{t}</span>
                        ))}
                      </div>
                    ) : null}
                    {node.eval_refs && node.eval_refs.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {node.eval_refs.map((e) => (
                          <span key={e} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">eval: {e}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {workflow.spec.edges && workflow.spec.edges.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Edges</h3>
                <div className="grid gap-1">
                  {workflow.spec.edges.map((edge, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="font-mono text-slate-400">{edge.from}</span>
                      <span className="text-slate-300">→</span>
                      <span className="font-mono text-slate-400">{edge.to}</span>
                      {edge.condition ? <span className="text-slate-500">({edge.condition})</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        </div>

        {/* ── Proof Readiness ── */}
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-slate-950">Proof Readiness</h2>

          {workflow.missingFields.length === 0 && missingLinks.length === 0 ? (
            <p className="mt-3 text-sm text-emerald-700">No missing fields or links detected.</p>
          ) : null}

          {workflow.missingFields.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase text-slate-400">Missing spec fields</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {workflow.missingFields.map((f) => (
                  <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{f}</span>
                ))}
              </div>
            </div>
          ) : null}

          {missingLinks.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase text-slate-400">
                Project-level gaps
                <span className="ml-1 font-normal normal-case text-slate-400">from source report</span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                These gaps come from the full source report, not just this workflow. They are informational — not failures.
              </p>
              <div className="mt-1.5 grid gap-1.5">
                {missingLinks.slice(0, 8).map((link, i) => (
                  <div key={i} className="rounded border border-slate-100 bg-slate-50 p-2 text-xs">
                    <p className="font-medium text-slate-700">{link.targetLabel}</p>
                    <p className="mt-0.5 text-slate-500">{link.recommendation}</p>
                  </div>
                ))}
                {missingLinks.length > 8 ? (
                  <p className="text-xs text-slate-400">+{missingLinks.length - 8} more gaps in source report</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500 space-y-1">
            <p>Optional mappings improve confidence. No source repo changes are required.</p>
            <p>Registered does not mean runtime-verified. Link runtime runs to confirm execution.</p>
          </div>
        </Card>
      </div>

      {/* ── Related Runs ── */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-950">Related Runtime Runs</h2>
        {relatedRuns.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No runtime runs linked yet. Runs will appear here when trace events use workflow ID{" "}
            <code className="font-mono text-xs">{workflow.workflowId}</code>.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {relatedRuns.map((run) => (
              <Link key={run.run_id} href={`/dashboard/runs/${run.run_id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 transition hover:border-teal-200">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{run.project_name}</p>
                    <p className="font-mono text-xs text-slate-400">{run.run_id}</p>
                  </div>
                  <Badge tone={run.status === "completed" ? "success" : run.status === "failed" ? "danger" : "warning"}>
                    {run.status}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* ── Actions ── */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-950">Actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => void updateStatus("active")}
            disabled={updatingStatus || workflow.status === "active"}
          >
            Mark active
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-300 disabled:cursor-not-allowed"
            onClick={() => void updateStatus("needs_review")}
            disabled={updatingStatus || workflow.status === "needs_review"}
          >
            Mark needs review
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed"
            onClick={() => void updateStatus("archived")}
            disabled={updatingStatus || workflow.status === "archived"}
          >
            Archive
          </button>

          <div className="ml-auto flex gap-3">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
              onClick={() => void copySpec()}
            >
              {copiedSpec ? "Copied!" : "Copy spec JSON"}
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
              onClick={() => downloadJson(`${workflow.workflowId}.workflow.json`, workflow.spec)}
            >
              Download spec
            </button>
            <button
              type="button"
              className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed"
              onClick={() => void deleteWorkflow()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </Card>
    </main>
  );
}

function Breadcrumb({ registryId, workflowName }: { registryId: string; workflowName?: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs font-medium text-slate-500" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-teal-700">Overview</Link>
      <span>/</span>
      <Link href="/dashboard/workflows" className="hover:text-teal-700">Workflows</Link>
      <span>/</span>
      <span className="text-slate-400">{workflowName ?? registryId}</span>
    </nav>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-slate-400">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4 text-center">
      <p className="text-xs font-medium uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
    </Card>
  );
}
