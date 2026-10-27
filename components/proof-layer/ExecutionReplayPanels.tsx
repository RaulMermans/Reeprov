"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { RunArtifact } from "@/lib/core/contracts/runArtifact";
import type { ReplayResult } from "@/lib/core/replay/contracts";
import { deriveExecutionStates, type ExecutionStateLabel } from "@/lib/dashboard/executionState";

const STATE_TONE: Record<ExecutionStateLabel, "success" | "info" | "warning" | "danger" | "neutral"> = {
  LIVE: "info",
  RECORDED: "neutral",
  FORKED: "info",
  REPLAYED: "success",
  "PARTIALLY VERIFIED": "warning",
  UNSUPPORTED: "danger",
};

function useRunEvidence(runId: string) {
  const [artifact, setArtifact] = useState<RunArtifact | null>(null);
  const [replays, setReplays] = useState<ReplayResult[]>([]);
  useEffect(() => {
    let cancelled = false;
    const headers = mergeAuthHeaders();
    Promise.all([
      fetch(`/api/runs/${encodeURIComponent(runId)}/canonical`, { headers }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/runs/${encodeURIComponent(runId)}/replays`, { headers }).then((r) => (r.ok ? r.json() : { replays: [] })),
    ])
      .then(([canonical, replayData]) => {
        if (cancelled) return;
        setArtifact(canonical);
        setReplays(replayData?.replays ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runId]);
  return { artifact, replays };
}

export function ExecutionStateBadges({ runId }: { runId: string }) {
  const { artifact, replays } = useRunEvidence(runId);
  if (!artifact) return null;
  return (
    <>
      {deriveExecutionStates(artifact, replays).map((state) => (
        <Badge key={state.label} tone={STATE_TONE[state.label]} title={state.detail} data-testid={`execution-state-${state.label.replace(" ", "-")}`}>
          {state.label}
        </Badge>
      ))}
    </>
  );
}

export function ReplaysPanel({ runId }: { runId: string }) {
  const { replays } = useRunEvidence(runId);
  return (
    <div className="grid gap-4" data-testid="replays-panel">
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-950">Offline Replays</h2>
        <p className="mt-1 text-xs text-slate-500">
          A replay re-executes the agent&apos;s own host code on the developer&apos;s machine (<code>reeprov host-replay</code>) and resolves every
          model and tool call from recorded evidence. Reeprov never runs agent code in the server. Timeline playback is not replay.
        </p>
        {replays.length === 0 ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600" data-testid="replays-empty">
            No replay recorded. Run <code>reeprov host-replay --run {runId} --adapter &lt;your-adapter&gt; --server &lt;url&gt; --upload</code>.
          </div>
        ) : null}
      </Card>
      {replays.map((replay) => (
        <Card key={replay.replay_id} className="p-5" data-testid="replay-card">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-900">{replay.replay_id}</span>
            <Badge tone={replay.status === "MATCHED" ? "success" : replay.status === "DIVERGED" ? "warning" : "danger"} data-testid="replay-status">
              {replay.status}
            </Badge>
            <Badge
              tone={replay.verification === "VERIFIED" ? "success" : replay.verification === "PARTIALLY_VERIFIED" ? "warning" : "neutral"}
              data-testid="replay-verification"
            >
              {replay.verification === "PARTIALLY_VERIFIED" ? "PARTIALLY VERIFIED" : (replay.verification ?? "UNVERIFIED")}
            </Badge>
            <Badge tone={replay.host_execution?.kind === "HOST_REEXECUTED" ? "info" : "warning"} data-testid="replay-execution-kind">
              {replay.host_execution?.kind === "HOST_REEXECUTED" ? "Host code re-executed" : "Recorded self-check (no host code ran)"}
            </Badge>
          </div>
          <dl className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
            <div><dt className="text-slate-400">Adapter</dt><dd className="font-mono">{replay.host_execution?.adapter ? `${replay.host_execution.adapter.adapter_id}@${replay.host_execution.adapter.adapter_version}` : "—"}</dd></div>
            <div><dt className="text-slate-400">Host steps executed</dt><dd>{replay.steps_executed} / {replay.steps_expected}</dd></div>
            <div><dt className="text-slate-400">Recorded calls substituted</dt><dd>{replay.boundaries_substituted} / {replay.boundaries_expected}</dd></div>
            <div><dt className="text-slate-400">Output</dt><dd data-testid="replay-output-check">{replay.output_check?.status ?? "—"}</dd></div>
          </dl>
          {(replay.boundary_matches ?? []).length > 0 ? (
            <table className="mt-3 w-full text-left text-xs" data-testid="replay-boundary-matches">
              <thead className="text-slate-400"><tr><th className="py-1">#</th><th>Call</th><th>Input verification</th><th>Side effect</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(replay.boundary_matches ?? []).map((m) => (
                  <tr key={m.boundary_id}>
                    <td className="py-1 font-mono">{m.sequence_index}</td>
                    <td className="font-mono">{m.name}</td>
                    <td><Badge tone={m.input_verification === "FULL" ? "success" : "warning"}>{m.input_verification}</Badge></td>
                    <td>{m.side_effect_substituted ? "recorded result substituted; not executed" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {(replay.state_checks ?? []).map((c) => (
            <p key={c.checkpoint_id} className="mt-2 text-xs text-slate-600">
              State after step {c.step_index} vs checkpoint <code>{c.checkpoint_id}</code>: <strong>{c.status}</strong>
            </p>
          ))}
          {replay.divergences.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-xs text-red-700" data-testid="replay-divergences">
              {replay.divergences.map((d) => <li key={d.divergence_id}><strong>{d.divergence_type}</strong>: {d.message}</li>)}
            </ul>
          ) : null}
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-800">
            {replay.limitations.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Card>
      ))}
    </div>
  );
}
