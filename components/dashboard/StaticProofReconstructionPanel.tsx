"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { ScanReport } from "@/lib/scanner/types";
import type { StaticProofReconstruction, SuggestedManifestFile } from "@/lib/reconstruction/types";

interface Props {
  report: ScanReport;
}

function confidenceTone(c: string): "success" | "warning" | "neutral" {
  if (c === "high") return "success";
  if (c === "medium") return "warning";
  return "neutral";
}

function severityTone(s: string): "danger" | "warning" | "neutral" | "info" {
  if (s === "high") return "danger";
  if (s === "medium") return "warning";
  if (s === "info") return "info";
  return "neutral";
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function MappingRow({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full ${pct === 100 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular-nums text-slate-500">{value}/{total}</span>
      </div>
    </div>
  );
}

export function StaticProofReconstructionPanel({ report }: Props) {
  const [reconstruction, setReconstruction] = useState<StaticProofReconstruction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<SuggestedManifestFile | null>(null);
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setReconstruction(null);
    setActiveFile(null);

    try {
      const res = await fetch("/api/reconstruct", {
        method: "POST",
        headers: mergeAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ report }),
      });

      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Reconstruction failed.");
        return;
      }

      const data = await res.json() as StaticProofReconstruction;
      setReconstruction(data);
      if (data.suggestedFiles.length > 0) {
        setActiveFile(data.suggestedFiles[0] ?? null);
      }
    } catch {
      setError("Could not connect to AgentPulse API.");
    } finally {
      setLoading(false);
    }
  }

  async function copyContent(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedHint("Copied!");
      setTimeout(() => setCopiedHint(null), 1500);
    } catch {
      setCopiedHint("Copy failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header banner */}
      <div className="rounded-md border border-teal-200 bg-teal-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-teal-800">Static Proof Reconstruction</p>
            <p className="mt-1 max-w-2xl text-xs text-teal-700">
              AgentPulse reconstructs a best-effort WorkflowSpec from static scan evidence.{" "}
              <strong>No code changes required.</strong> Runtime trace instrumentation is optional.
            </p>
          </div>
          <button
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={loading}
            onClick={generate}
            type="button"
          >
            {loading ? "Generating…" : reconstruction ? "Regenerate proof spec" : "Generate proof spec"}
          </button>
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>
      ) : null}

      {loading ? (
        <Card className="p-6 text-sm text-slate-500">Reconstructing from scan evidence…</Card>
      ) : null}

      {reconstruction && !loading ? (
        <>
          {/* No-evidence empty state — shown when no workflowSpecs were generated. */}
          {reconstruction.workflowSpecs.length === 0 ? (
            <Card className="border-slate-200 bg-slate-50 p-6">
              <p className="text-base font-semibold text-slate-900">
                No AI workflow reconstruction generated
              </p>
              <p className="mt-2 max-w-2xl text-sm text-slate-700">
                AgentPulse did not find enough agent, workflow, prompt, tool, eval, or model
                evidence to generate a proof-layer WorkflowSpec.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                CI workflows, generic tests, package files, README mentions, and assistant
                tooling (<code className="font-mono">.claude/</code>, <code className="font-mono">.cursor/</code>)
                do not count as AI evidence on their own.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href="#findings"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                >
                  View scan findings
                </a>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300"
                  onClick={() =>
                    downloadText(
                      `${report.repoName}-scan-report.json`,
                      JSON.stringify(report, null, 2),
                      "application/json",
                    )
                  }
                >
                  Download report JSON
                </button>
              </div>
            </Card>
          ) : null}

          {/* Confidence + overview */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">Reconstruction confidence</p>
                <Badge tone={confidenceTone(reconstruction.confidence)} className="mt-1">
                  {reconstruction.confidence}
                </Badge>
              </div>
              <div className="ml-4">
                <p className="text-xs font-medium uppercase text-slate-500">Workflows inferred</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{reconstruction.workflowSpecs.length}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">Missing links</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{reconstruction.missingLinks.length}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">Graph nodes</p>
                <p className="mt-1 text-sm font-semibold text-slate-950">{reconstruction.systemGraph.nodes.length}</p>
              </div>
            </div>
            <p className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Mode: <strong>static_inference</strong> — inferred from repo files, not runtime execution.
              {reconstruction.confidence === "low" && reconstruction.workflowSpecs.length > 0 && (
                <span className="ml-1 text-amber-700">
                  Low-confidence static reconstruction. Review suggested files before using them.
                </span>
              )}
              {reconstruction.confidence === "low" && reconstruction.workflowSpecs.length === 0 && (
                <span className="ml-1 text-amber-700">
                  Add an agents.yaml or workflow.yaml to enable reconstruction.
                </span>
              )}
            </p>
          </Card>

          {/* Inferred WorkflowSpecs — only when at least one exists */}
          {reconstruction.workflowSpecs.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Inferred Workflow Specs</h3>
            {reconstruction.workflowSpecs.map((spec) => (
              <Card key={spec.workflow_id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">{spec.name}</p>
                      <Badge tone={confidenceTone(spec.confidence)}>{spec.confidence}</Badge>
                      <Badge tone="neutral">{spec.source}</Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-400">{spec.workflow_id}</p>
                    <p className="mt-1 text-xs text-slate-600">{spec.description}</p>
                  </div>
                  <Badge tone="info">{spec.architecture_type}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
                  <div>
                    <dt className="font-medium text-slate-400">Nodes</dt>
                    <dd>{spec.nodes.length}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Edges</dt>
                    <dd>{spec.edges?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Tools</dt>
                    <dd>{spec.allowed_tools?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Evals</dt>
                    <dd>{spec.evals?.length ?? 0}</dd>
                  </div>
                </dl>
                {spec.missingFields.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-slate-500">Missing fields:</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {spec.missingFields.map((f) => (
                        <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{f}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {spec.recommendations.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-teal-700">
                    {spec.recommendations.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                ) : null}
              </Card>
            ))}
          </div>
          ) : null}

          {/* Mapping Summary */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-950">Mapping Coverage</h3>
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              <MappingRow label="Agents → Prompts" value={reconstruction.mappingSummary.agents.mappedToPrompts} total={reconstruction.mappingSummary.agents.total} />
              <MappingRow label="Agents → Tools" value={reconstruction.mappingSummary.agents.mappedToTools} total={reconstruction.mappingSummary.agents.total} />
              <MappingRow label="Agents → Evals" value={reconstruction.mappingSummary.agents.mappedToEvals} total={reconstruction.mappingSummary.agents.total} />
              <MappingRow label="Agents → Models" value={reconstruction.mappingSummary.agents.mappedToModels} total={reconstruction.mappingSummary.agents.total} />
              <MappingRow label="Workflows with stages" value={reconstruction.mappingSummary.workflows.withStages} total={reconstruction.mappingSummary.workflows.total} />
              <MappingRow label="Prompts mapped" value={reconstruction.mappingSummary.prompts.mapped} total={reconstruction.mappingSummary.prompts.total} />
              <MappingRow label="Evals mapped" value={reconstruction.mappingSummary.evals.mapped} total={reconstruction.mappingSummary.evals.total} />
              <MappingRow label="Models mapped" value={reconstruction.mappingSummary.models.mapped} total={reconstruction.mappingSummary.models.total} />
            </div>
          </Card>

          {/* Missing Links */}
          {reconstruction.missingLinks.length > 0 ? (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-950">Missing Links</h3>
              <div className="flex flex-col divide-y divide-slate-100">
                {reconstruction.missingLinks.slice(0, 15).map((link) => (
                  <div key={link.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="break-all text-xs font-medium text-slate-700">{link.targetLabel}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{link.recommendation}</p>
                    </div>
                    <Badge tone={severityTone(link.severity)} className="shrink-0">{link.type.replace(/_/g, " ")}</Badge>
                  </div>
                ))}
                {reconstruction.missingLinks.length > 15 ? (
                  <p className="pt-2 text-xs text-slate-400">
                    +{reconstruction.missingLinks.length - 15} more missing links
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Suggested Files — clearly labeled as suggestions, only shown when present */}
          {reconstruction.suggestedFiles.length > 0 ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Suggested Manifest Files</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Generated suggestions — review before using.{" "}
                  {reconstruction.workflowSpecs.length === 0
                    ? "No WorkflowSpec was generated because no AI evidence was detected."
                    : "These are starting points, not verified truth."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {reconstruction.suggestedFiles.map((file) => (
                  <button
                    key={file.path}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                      activeFile?.path === file.path
                        ? "border-teal-700 bg-teal-50 text-teal-800"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
                    }`}
                    onClick={() => setActiveFile(file)}
                    type="button"
                  >
                    {file.path}
                  </button>
                ))}
              </div>
            </div>

            {activeFile ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-slate-700">{activeFile.path}</p>
                    <p className="text-xs text-slate-500">{activeFile.purpose}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300"
                      onClick={() => void copyContent(activeFile.content)}
                      type="button"
                    >
                      {copiedHint ?? "Copy"}
                    </button>
                    <button
                      className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-teal-800"
                      onClick={() =>
                        downloadText(
                          activeFile.path,
                          activeFile.content,
                          activeFile.format === "json" ? "application/json" : activeFile.format === "yaml" ? "text/yaml" : "text/markdown",
                        )
                      }
                      type="button"
                    >
                      Download {activeFile.format.toUpperCase()}
                    </button>
                  </div>
                </div>
                <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-4 text-xs leading-relaxed text-slate-200 whitespace-pre-wrap">
                  {activeFile.content}
                </pre>
              </div>
            ) : null}
          </Card>
          ) : null}

          {/* Instrumentation Plan callout */}
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <p className="font-medium text-slate-700">Runtime instrumentation is optional</p>
            <p className="mt-1">{reconstruction.instrumentationPlan.summary}</p>
            <p className="mt-2 text-slate-500">
              Required env vars if you opt in:{" "}
              <code className="font-mono">{reconstruction.instrumentationPlan.recommendedEnvVars.join(", ")}</code>
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
