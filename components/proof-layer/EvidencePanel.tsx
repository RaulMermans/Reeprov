"use client";

import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatDuration, formatDateTime } from "./format";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";
import {
  computeEvidenceCompleteness,
  correlateActionTrail,
  type CorrelatedActionTrail,
  type EvidenceCompleteness,
} from "@/lib/core/contracts/evidence";

interface EvidencePanelProps {
  runId: string;
  initialArtifact?: RunArtifact;
}

export function EvidencePanel({ runId, initialArtifact }: EvidencePanelProps) {
  const [artifact, setArtifact] = useState<RunArtifact | null>(initialArtifact ?? null);
  const [loading, setLoading] = useState(!initialArtifact);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialArtifact) {
      setArtifact(initialArtifact);
      setLoading(false);
      return;
    }

    async function loadArtifact() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/canonical`, {
          headers: mergeAuthHeaders(),
        });
        if (!res.ok) {
          setError(`Failed to load canonical evidence (status ${res.status}).`);
          return;
        }
        const data = (await res.json()) as RunArtifact;
        setArtifact(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    void loadArtifact();
  }, [runId, initialArtifact]);

  const completeness: EvidenceCompleteness | null = useMemo(() => {
    if (!artifact) return null;
    return computeEvidenceCompleteness(artifact);
  }, [artifact]);

  const actionTrails: Map<string, CorrelatedActionTrail> = useMemo(() => {
    if (!artifact) return new Map();
    const tools = (artifact.tools ?? []).map((t) => ({
      tool_call_id: t.tool_call_id,
      tool_name: t.tool_name,
      status: t.status,
      step_id: t.step_id,
    }));
    return correlateActionTrail(artifact.evidence, tools);
  }, [artifact]);

  if (loading) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        Loading run evidence and configuration plane…
      </Card>
    );
  }

  if (error || !artifact) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        <p className="font-medium text-slate-700">No canonical evidence plane available</p>
        <p className="mt-1 text-xs text-slate-500">
          {error ?? "This run does not contain an AgentPulse canonical evidence block."}
        </p>
      </Card>
    );
  }

  const evidence = artifact.evidence;
  const config = artifact.configuration_snapshot;
  const isFork = Boolean(artifact.lineage?.parent_run_id);
  const outcome = evidence?.final_outcome?.status ?? (artifact.execution.status === "completed" ? "SUCCESS" : "FAILURE");
  const verificationStatus = evidence?.final_outcome?.verification_status ?? "NOT_RUN";

  const testsCount = evidence?.test_results?.length ?? 0;
  const testsPassed = evidence?.test_results?.filter((t) => t.status === "PASSED").length ?? 0;
  const reviewsCount = evidence?.review_results?.length ?? 0;
  const reviewsPassed = evidence?.review_results?.filter((r) => r.status === "PASSED").length ?? 0;
  const approvalsGranted = evidence?.approval_events?.filter((a) => a.decision === "GRANTED").length ?? 0;
  const blocksCount = evidence?.security_events?.filter(
    (s) => s.decision === "BLOCKED" || s.decision === "DENY"
  ).length ?? 0;
  const artifactsCount = artifact.artifacts?.length ?? 0;

  return (
    <div className="grid gap-8" data-testid="evidence-panel">
      {/* ── SECTION 1: RUN EVIDENCE OVERVIEW ── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Run Evidence & Verification Plane</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Deterministic proof layer: configuration provenance, explicit plans, tests, reviews, and security telemetry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              tone={outcome === "SUCCESS" ? "success" : outcome === "FAILURE" ? "danger" : "warning"}
              className="text-sm font-semibold uppercase px-2.5 py-1"
            >
              Outcome: {outcome}
            </Badge>
            <Badge
              tone={verificationStatus === "PASS" ? "success" : verificationStatus === "FAIL" ? "danger" : "neutral"}
              className="text-xs uppercase"
            >
              Verification: {verificationStatus}
            </Badge>
          </div>
        </div>

        {/* Top Summary Metrics */}
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Tests</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-800">
              {testsPassed}/{testsCount}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Reviews</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-800">
              {reviewsPassed}/{reviewsCount}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Approvals</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-800">
              {approvalsGranted}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Blocks</p>
            <p className={`mt-1 font-mono text-base font-bold ${blocksCount > 0 ? "text-red-700" : "text-slate-800"}`}>
              {blocksCount}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Artifacts</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-800">
              {artifactsCount}
            </p>
          </div>
          <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Events</p>
            <p className="mt-1 font-mono text-base font-bold text-slate-800">
              {evidence?.verification_events?.length ?? 0}
            </p>
          </div>
          <div className="col-span-2 rounded-md border border-slate-100 bg-slate-50 p-3 text-center">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Evidence Coverage</p>
            <p className="mt-1 font-mono text-base font-bold text-teal-700">
              {completeness ? `${completeness.score}% captured` : "N/A"}
            </p>
          </div>
        </div>

        {/* Coverage Status Matrix */}
        {completeness && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Evidence Completeness Matrix
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {Object.entries(completeness.coverage).map(([key, status]) => (
                <div
                  key={key}
                  className="flex flex-col items-center justify-center rounded border border-slate-100 p-2 text-center"
                >
                  <span className="text-[11px] font-medium text-slate-700 capitalize">{key}</span>
                  <span className="mt-1">
                    {status === "PRESENT" && <Badge tone="success">✓ Present</Badge>}
                    {status === "NOT_CAPTURED" && <Badge tone="neutral">− Not Captured</Badge>}
                    {status === "MISSING_REQUIRED" && <Badge tone="danger">✗ Missing</Badge>}
                    {status === "NOT_APPLICABLE" && <Badge tone="neutral">N/A</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── SECTION 2: CONFIGURATION PLANE ── */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Agent Configuration Snapshot</h3>
            <p className="text-xs text-slate-500">
              Deterministic, hash-verified snapshot of the effective configuration that produced this run.
            </p>
          </div>
          {config?.config_hash && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Config Hash:</span>
              <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
                {config.config_hash.slice(0, 19)}…
              </code>
            </div>
          )}
        </div>

        {isFork && artifact.lineage && (
          <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="info">Forked Run</Badge>
              <span className="text-xs font-medium text-violet-900">
                Inherited baseline configuration from parent run:{" "}
                <code className="font-mono text-violet-700">{artifact.lineage.parent_run_id}</code>
              </span>
            </div>
            {artifact.lineage.mutations && artifact.lineage.mutations.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-violet-950">Applied Configuration Mutations:</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-violet-800">
                  {artifact.lineage.mutations.map((m, idx) => (
                    <li key={idx}>
                      <span className="font-semibold">{m.mutation_type}</span> on{" "}
                      <code className="font-mono">{m.target_identifier}</code>: {m.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {config ? (
          <div className="mt-5 grid gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase">Agent Identity</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                  {config.agent.id}@{config.agent.version}
                </p>
                {config.agent.name && <p className="text-xs text-slate-600">{config.agent.name}</p>}
                {config.agent_hash && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">hash: {config.agent_hash.slice(0, 12)}…</p>
                )}
              </div>

              <div className="rounded border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase">Model</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-900">
                  {config.model.provider}/{config.model.model_id}
                </p>
                {config.model.resolved_revision && (
                  <p className="text-xs text-slate-600">rev: {config.model.resolved_revision}</p>
                )}
                {config.model_hash && (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">hash: {config.model_hash.slice(0, 12)}…</p>
                )}
              </div>

              <div className="rounded border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase">Permissions Policy</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {config.permissions.policy_id ?? "Default Policy"} (v{config.permissions.policy_version ?? "1"})
                </p>
                <p className="text-xs text-slate-600">
                  {config.permissions.granted_capabilities?.length ?? 0} capabilities granted
                </p>
              </div>

              <div className="rounded border border-slate-100 p-3">
                <p className="text-xs font-semibold text-slate-500 uppercase">Runtime Environment</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {config.runtime?.framework ?? "Native"} | {config.runtime?.language_runtime ?? "Node"}
                </p>
                {config.runtime?.git_sha && (
                  <p className="font-mono text-xs text-slate-500">git: {config.runtime.git_sha.slice(0, 8)}</p>
                )}
              </div>
            </div>

            {/* Prompts, Skills, Tools Tables */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-200 p-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Prompts ({config.prompts.length})
                </h4>
                <div className="mt-2 space-y-1.5 text-xs">
                  {config.prompts.map((p) => (
                    <div key={p.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
                      <span className="font-mono text-slate-800">{p.id}</span>
                      <span className="text-slate-500">v{p.version}</span>
                    </div>
                  ))}
                  {config.prompts.length === 0 && <p className="text-slate-400">None declared</p>}
                </div>
              </div>

              <div className="rounded border border-slate-200 p-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Skills ({config.skills.length})
                </h4>
                <div className="mt-2 space-y-1.5 text-xs">
                  {config.skills.map((s) => (
                    <div key={s.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
                      <span className="font-mono text-slate-800">{s.id}</span>
                      <span className="text-slate-500">v{s.version}</span>
                    </div>
                  ))}
                  {config.skills.length === 0 && <p className="text-slate-400">None declared</p>}
                </div>
              </div>

              <div className="rounded border border-slate-200 p-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Tools ({config.tools.length})
                </h4>
                <div className="mt-2 space-y-1.5 text-xs">
                  {config.tools.map((t) => (
                    <div key={t.id} className="flex items-center justify-between border-b border-slate-50 pb-1">
                      <span className="font-mono text-slate-800">{t.id}</span>
                      <span className="text-slate-500">
                        v{t.version} {t.permission_class ? `(${t.permission_class})` : ""}
                      </span>
                    </div>
                  ))}
                  {config.tools.length === 0 && <p className="text-slate-400">None declared</p>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-xs text-slate-400 italic">No agent configuration snapshot attached to this run.</p>
        )}
      </Card>

      {/* ── SECTION 3: EXPLICIT PLAN EVIDENCE ── */}
      {evidence?.plan && (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Explicit Emitted Plan</h3>
              <p className="text-xs text-slate-500">Structured goal declaration emitted explicitly by runtime.</p>
            </div>
            <Badge tone="info">{evidence.plan.status}</Badge>
          </div>
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-900">
              <span className="font-semibold text-slate-600">Goal:</span> {evidence.plan.goal}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Producer: {evidence.plan.producer} · Created: {formatDateTime(evidence.plan.created_at)}
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {evidence.plan.items.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-start justify-between rounded border border-slate-100 bg-slate-50 p-3 text-xs"
              >
                <div className="flex items-start gap-2">
                  <span className="font-mono font-bold text-slate-400">{idx + 1}.</span>
                  <div>
                    <p className="font-medium text-slate-800">{item.description}</p>
                    {item.dependencies && item.dependencies.length > 0 && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Depends on: {item.dependencies.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  tone={
                    item.status === "COMPLETED"
                      ? "success"
                      : item.status === "FAILED"
                        ? "danger"
                        : item.status === "IN_PROGRESS"
                          ? "info"
                          : "neutral"
                  }
                >
                  {item.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── SECTION 4: TESTS & REVIEWS ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tests */}
        <Card className="p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              Test Results ({evidence?.test_results?.length ?? 0})
            </h3>
            <span className="text-xs text-slate-500">{testsPassed} passed</span>
          </div>
          <div className="mt-4 space-y-3">
            {evidence?.test_results?.map((t) => (
              <div key={t.test_id} className="rounded border border-slate-100 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-800">
                    {t.suite} › {t.name}
                  </p>
                  <Badge tone={t.status === "PASSED" ? "success" : "danger"}>{t.status}</Badge>
                </div>
                {t.duration_ms !== undefined && (
                  <p className="mt-1 text-[11px] text-slate-500">Duration: {formatDuration(t.duration_ms)}</p>
                )}
                {t.failure_message && (
                  <p className="mt-2 rounded bg-red-50 p-2 font-mono text-red-700">{t.failure_message}</p>
                )}
              </div>
            ))}
            {(!evidence?.test_results || evidence.test_results.length === 0) && (
              <p className="text-xs text-slate-400 italic">No automated tests recorded for this run.</p>
            )}
          </div>
        </Card>

        {/* Reviews */}
        <Card className="p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">
              Review Results ({evidence?.review_results?.length ?? 0})
            </h3>
            <span className="text-xs text-slate-500">{reviewsPassed} approved</span>
          </div>
          <div className="mt-4 space-y-3">
            {evidence?.review_results?.map((r) => (
              <div key={r.review_id} className="rounded border border-slate-100 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="info">{r.review_type}</Badge>
                    <span className="font-semibold text-slate-800">{r.reviewer}</span>
                  </div>
                  <Badge tone={r.status === "PASSED" ? "success" : "warning"}>{r.status}</Badge>
                </div>
                {r.findings && r.findings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {r.findings.map((f, i) => (
                      <p key={i} className="text-slate-700">
                        • <span className="font-semibold text-slate-900">[{f.category}]</span> {f.message}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(!evidence?.review_results || evidence.review_results.length === 0) && (
              <p className="text-xs text-slate-400 italic">No code or safety reviews recorded for this run.</p>
            )}
          </div>
        </Card>
      </div>

      {/* ── SECTION 5: SECURITY & PERMISSION TIMELINE (ACTION CORRELATION) ── */}
      <Card className="p-6">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">Security & Privileged Action Timeline</h3>
          <p className="text-xs text-slate-500">
            Forensic correlation connecting action requests, policy evaluations, approval gates, tool executions, and verifications.
          </p>
        </div>

        <div className="mt-4 space-y-4">
          {Array.from(actionTrails.entries()).map(([actionId, trail]) => (
            <div key={actionId} className="rounded-lg border border-slate-200 bg-white p-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-900">Action: {actionId}</span>
                  {trail.tool_id && <Badge tone="info">Tool: {trail.tool_id}</Badge>}
                </div>
                {trail.permission_checked && (
                  <Badge
                    tone={
                      trail.permission_checked.decision === "ALLOW"
                        ? "success"
                        : trail.permission_checked.decision === "DENY" || trail.permission_checked.decision === "BLOCKED"
                          ? "danger"
                          : "warning"
                    }
                  >
                    Policy: {trail.permission_checked.decision}
                  </Badge>
                )}
              </div>

              {/* Chronological Trail */}
              <div className="mt-3 space-y-1.5 pl-2 border-l-2 border-slate-200">
                {trail.timeline.map((step, idx) => (
                  <div key={idx} className="flex items-baseline justify-between gap-4 text-[11px]">
                    <div>
                      <span className="font-semibold text-slate-700">{step.type}</span>:{" "}
                      <span className="text-slate-600">{step.details}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-400">{formatDateTime(step.timestamp)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {actionTrails.size === 0 && (
            <p className="text-xs text-slate-400 italic">No privileged actions or security events recorded for this run.</p>
          )}
        </div>
      </Card>

      {/* ── SECTION 6: APPEND-ONLY VERIFICATION CHRONOLOGY ── */}
      <Card className="p-6">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900">
            Verification Chronology ({evidence?.verification_events?.length ?? 0} events)
          </h3>
          <p className="text-xs text-slate-500">
            Immutable, append-only execution evidence events ordered monotonically.
          </p>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-semibold uppercase text-slate-500">
                <th className="px-3 py-2">Seq</th>
                <th className="px-3 py-2">Event Type</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {(evidence?.verification_events ?? []).map((e) => (
                <tr key={e.event_id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-400">{e.sequence_index}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{e.event_type}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {e.target_type} {e.target_id ? `(${e.target_id})` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        e.status === "PASSED" || e.status === "GRANTED" || e.status === "VERIFIED"
                          ? "success"
                          : e.status === "FAILED" || e.status === "REJECTED" || e.status === "BLOCKED"
                            ? "danger"
                            : "info"
                      }
                    >
                      {e.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{e.actor}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDuration(e.duration_ms)}</td>
                  <td className="px-3 py-2 text-slate-400">{formatDateTime(e.completed_at ?? e.started_at)}</td>
                </tr>
              ))}
              {(!evidence?.verification_events || evidence.verification_events.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-slate-400 italic">
                    No verification events recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
