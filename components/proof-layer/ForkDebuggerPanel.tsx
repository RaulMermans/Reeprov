"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import type { CheckpointReference, ExperimentMutation } from "@/lib/core/contracts/lineage";
import type { ForkResult } from "@/lib/core/fork/contracts";

interface LineageData {
  run_id: string;
  parent_run_id: string | null;
  root_run_id: string;
  fork_checkpoint_id: string | null;
  mutations: ExperimentMutation[];
  ancestors: Array<{ run_id: string; created_at: string; status: string }>;
  children: Array<{ run_id: string; fork_checkpoint_id?: string; created_at: string; status: string }>;
}

export function ForkDebuggerPanel({ runId }: { runId: string }) {
  const [checkpoints, setCheckpoints] = useState<CheckpointReference[]>([]);
  const [lineage, setLineage] = useState<LineageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<CheckpointReference | null>(null);

  // Mutation form state
  const [mutationType, setMutationType] = useState<
    "state_patch" | "tool_result_override" | "prompt" | "model_parameters" | "context_exclusion" | "memory_exclusion"
  >("tool_result_override");
  const [targetIdentifier, setTargetIdentifier] = useState("get_customer_account");
  const [mutatedValueRaw, setMutatedValueRaw] = useState('{\n  "customerId": "cus_1001",\n  "balance": 300,\n  "currency": "USD",\n  "status": "active"\n}');
  const [description, setDescription] = useState("Controlled fork test mutation");

  // Fork Execution state
  const [forking, setForking] = useState(false);
  const [forkResult, setForkResult] = useState<ForkResult | null>(null);
  const [forkError, setForkError] = useState<string | null>(null);

  async function loadData() {
    try {
      setLoading(true);
      const [chkRes, linRes] = await Promise.all([
        fetch(`/api/runs/${encodeURIComponent(runId)}/checkpoints`, {
          headers: mergeAuthHeaders(),
        }),
        fetch(`/api/runs/${encodeURIComponent(runId)}/lineage`, {
          headers: mergeAuthHeaders(),
        }),
      ]);

      if (chkRes.ok) {
        const chkData = await chkRes.json();
        setCheckpoints(chkData.checkpoints ?? []);
        if (chkData.checkpoints?.length > 0 && !selectedCheckpoint) {
          setSelectedCheckpoint(chkData.checkpoints[0]);
        }
      }

      if (linRes.ok) {
        const linData = await linRes.json();
        setLineage(linData);
      }
    } catch {
      // Ignore errors loading panel
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [runId]);

  async function handleExecuteFork() {
    if (!selectedCheckpoint) return;
    setForking(true);
    setForkError(null);
    setForkResult(null);

    let parsedMutatedValue: unknown = mutatedValueRaw;
    try {
      parsedMutatedValue = JSON.parse(mutatedValueRaw);
    } catch {
      // Keep as string if not JSON
    }

    const mutations: ExperimentMutation[] = targetIdentifier.trim()
      ? [
          {
            mutation_id: `mut_${Date.now()}`,
            mutation_type: mutationType,
            target_identifier: targetIdentifier.trim(),
            description: description.trim() || "Controlled fork mutation",
            mutated_value: parsedMutatedValue,
          },
        ]
      : [];

    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/fork`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...mergeAuthHeaders(),
        },
        body: JSON.stringify({
          checkpoint_id: selectedCheckpoint.checkpoint_id,
          mutations,
          execution_mode: "SAFE_OFFLINE_FORK",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setForkError(data.message ?? data.errors?.[0] ?? "Failed to execute fork.");
      } else {
        setForkResult(data);
        loadData(); // Refresh lineage children
      }
    } catch (err: any) {
      setForkError(err.message ?? "Network error during fork execution.");
    } finally {
      setForking(false);
    }
  }

  return (
    <div className="grid gap-6" data-testid="fork-debugger-panel">
      {/* ── Lineage Tree Header ── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Lineage & Branch Visualization</h2>
            <p className="mt-1 text-xs text-slate-500">
              Track ancestry, checkpoints, and derived executions branching from this run.
            </p>
          </div>
          <Badge tone={lineage?.parent_run_id ? "info" : "neutral"}>
            {lineage?.parent_run_id ? "Derived Fork" : "Root Execution"}
          </Badge>
        </div>

        {lineage && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-700">
            {lineage.parent_run_id ? (
              <div className="space-y-1">
                <div>
                  <span className="text-slate-400">Parent: </span>
                  <Link href={`/dashboard/runs/${lineage.parent_run_id}`} className="font-semibold text-teal-700 hover:underline">
                    {lineage.parent_run_id}
                  </Link>
                </div>
                <div className="text-slate-400 pl-4">│</div>
                <div className="text-slate-400 pl-4">└── checkpoint: {lineage.fork_checkpoint_id ?? "unknown"}</div>
                <div className="text-slate-400 pl-8">│</div>
                <div className="pl-8 font-semibold text-slate-900">
                  └── this run: {lineage.run_id} (current)
                </div>
              </div>
            ) : (
              <div>
                <span className="font-semibold text-slate-900">{lineage.run_id}</span> (Root Run)
              </div>
            )}

            {lineage.children && lineage.children.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <p className="font-sans text-xs font-semibold uppercase text-slate-500">Derived Fork Runs ({lineage.children.length})</p>
                <div className="mt-2 space-y-1">
                  {lineage.children.map((child) => (
                    <div key={child.run_id} className="flex items-center gap-2">
                      <span className="text-slate-400">└──</span>
                      <Link href={`/dashboard/runs/${child.run_id}`} className="font-semibold text-teal-700 hover:underline">
                        {child.run_id}
                      </Link>
                      <Badge tone="success" className="text-[10px]">
                        {child.status}
                      </Badge>
                      <span className="text-slate-400 text-[10px]">via {child.fork_checkpoint_id}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Checkpoints Table ── */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold text-slate-950">Recorded Execution Checkpoints</h2>
        <p className="mt-1 text-xs text-slate-500">
          Restore supported recorded execution checkpoints into a compatible host, apply controlled mutations, and branch execution.
        </p>

        {loading ? (
          <p className="mt-4 text-xs text-slate-400">Loading checkpoints...</p>
        ) : checkpoints.length === 0 ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            No checkpoints recorded for this run. To enable &ldquo;Fork from here&rdquo;, create checkpoints via <code>session.checkpoint(state, options)</code> in your workflow.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 uppercase">
                <tr>
                  <th className="py-2 pr-4 font-medium">Checkpoint</th>
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 font-medium">Position</th>
                  <th className="py-2 pr-4 font-medium">Boundary Cursor</th>
                  <th className="py-2 pr-4 font-medium">Restorable</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {checkpoints.map((chk) => (
                  <tr key={chk.checkpoint_id} className={selectedCheckpoint?.checkpoint_id === chk.checkpoint_id ? "bg-teal-50/50" : ""}>
                    <td className="py-2.5 pr-4 font-mono font-medium text-slate-900">{chk.checkpoint_id}</td>
                    <td className="py-2.5 pr-4 font-mono text-slate-600">{chk.step_id}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone="neutral">{chk.position ?? "AFTER_STEP"}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">{chk.boundary_cursor ?? 0}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={chk.restorable !== false ? "success" : "danger"}>
                        {chk.restorable !== false ? "Restorable" : "Corrupt / Missing"}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right">
                      <Button
                        variant={selectedCheckpoint?.checkpoint_id === chk.checkpoint_id ? "primary" : "secondary"}
                        onClick={() => setSelectedCheckpoint(chk)}
                        data-testid={`fork-from-here-${chk.checkpoint_id}`}
                      >
                        Fork from here
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Fork Execution Affordance ── */}
      {selectedCheckpoint && (
        <Card className="border-teal-200 bg-white p-5" data-testid="fork-config-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-slate-950">
                Branch from Checkpoint: <span className="font-mono text-teal-700">{selectedCheckpoint.checkpoint_id}</span>
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Step: <code className="font-semibold">{selectedCheckpoint.step_id}</code> | Boundary Cursor:{" "}
                <code className="font-semibold">{selectedCheckpoint.boundary_cursor ?? 0}</code> | State Snapshot:{" "}
                <code className="font-semibold">{selectedCheckpoint.state_snapshot_id ?? "initial"}</code>
              </p>
            </div>
            <Badge tone="info">SAFE_OFFLINE_FORK (recorded substitutions)</Badge>
          </div>

          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Controlled Mutation (Optional)</h4>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Mutation Type</label>
                <select
                  value={mutationType}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setMutationType(val);
                    if (val === "tool_result_override") {
                      setTargetIdentifier("get_customer_account");
                      setMutatedValueRaw('{\n  "customerId": "cus_1001",\n  "balance": 300,\n  "currency": "USD",\n  "status": "active"\n}');
                    } else if (val === "state_patch") {
                      setTargetIdentifier("/customer/vip");
                      setMutatedValueRaw("true");
                    } else if (val === "prompt") {
                      setTargetIdentifier("synthesis_prompt");
                      setMutatedValueRaw("Provide a concise 1-sentence balance report.");
                    } else if (val === "model_parameters") {
                      setTargetIdentifier("temperature");
                      setMutatedValueRaw("0.0");
                    } else if (val === "context_exclusion") {
                      setTargetIdentifier("ctx_item_sample");
                      setMutatedValueRaw('{"excluded": true}');
                    } else if (val === "memory_exclusion") {
                      setTargetIdentifier("mem_sample_id");
                      setMutatedValueRaw('{"excluded": true}');
                    }
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 text-xs"
                >
                  <option value="tool_result_override">TOOL_RESULT_OVERRIDE (Override specific tool return)</option>
                  <option value="state_patch">STATE_PATCH (Deterministic state JSON patch)</option>
                  <option value="prompt">PROMPT_OVERRIDE (Candidate prompt template)</option>
                  <option value="model_parameters">MODEL_PARAMETER_OVERRIDE (Temperature, parameters)</option>
                  <option value="context_exclusion">CONTEXT_EXCLUSION (Ablate context item or source type)</option>
                  <option value="memory_exclusion">MEMORY_EXCLUSION (Ablate memory item)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Target Identifier / Key</label>
                <input
                  type="text"
                  value={targetIdentifier}
                  onChange={(e) => setTargetIdentifier(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                  placeholder="e.g. get_customer_account or /customer/vip"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Mutated Value (JSON or Primitive)</label>
              <textarea
                value={mutatedValueRaw}
                onChange={(e) => setMutatedValueRaw(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                placeholder='e.g. { "balance": 300 } or "true"'
              />
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <div className="text-xs text-slate-500">
                Prefix will not be re-executed. Known Node network and subprocess APIs are blocked; untrusted code needs separate process isolation.
              </div>
              <Button
                onClick={handleExecuteFork}
                disabled={forking}
                data-testid="execute-fork-button"
              >
                {forking ? "Branching Execution..." : "Execute Fork From Here"}
              </Button>
            </div>

            {forkError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700" data-testid="fork-error-message">
                Error: {forkError}
              </div>
            )}

            {/* ── Post-Execution Result ── */}
            {forkResult && (
              <div className="rounded-md border border-teal-200 bg-teal-50 p-4" data-testid="fork-result-card">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-teal-900">Fork Execution Completed Successfully!</h4>
                  <Badge tone="success">{forkResult.status}</Badge>
                </div>

                <div className="mt-3 font-mono text-xs text-teal-950 space-y-1">
                  <div>Parent: {forkResult.parent_run_id}</div>
                  <div className="pl-4">│</div>
                  <div className="pl-4">└── Fork: <Link href={`/dashboard/runs/${forkResult.derived_run_id}`} className="font-semibold underline hover:text-teal-700">{forkResult.derived_run_id}</Link></div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
                  <div className="rounded border border-teal-100 bg-white p-3">
                    <p className="font-semibold uppercase text-slate-500 text-[10px]">Original Output (Parent)</p>
                    <Link href={`/dashboard/runs/${encodeURIComponent(runId)}`} className="mt-1 inline-block text-slate-700 underline">
                      View recorded source output
                    </Link>
                  </div>
                  <div className="rounded border border-teal-100 bg-white p-3">
                    <p className="font-semibold uppercase text-teal-600 text-[10px]">Fork Output (Derived)</p>
                    <p className="mt-1 font-mono text-teal-900 font-medium">
                      {typeof forkResult.final_output === "string" ? forkResult.final_output : JSON.stringify(forkResult.final_output)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 text-right">
                  <Link
                    href={`/dashboard/runs/${forkResult.derived_run_id}`}
                    className="inline-flex items-center rounded bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800"
                  >
                    Open Derived Run →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
