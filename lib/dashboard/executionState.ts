/**
 * Execution state labels shown in Studio. Each label is derived only from
 * evidence; none is inferred from timeline animation.
 *
 * LIVE                 the run is executing and receiving evidence now
 * RECORDED             a captured execution (not re-executed by Reeprov)
 * FORKED               a resumed fork of a parent run from a registered checkpoint
 * REPLAYED             host code was re-executed offline and fully verified
 * PARTIALLY VERIFIED   host re-execution matched, but some inputs or the output could only be compared after redaction
 * UNSUPPORTED          a replay was attempted and refused, with a specific reason
 */

import type { RunArtifact } from "@/lib/core/contracts/runArtifact";
import type { ReplayResult } from "@/lib/core/replay/contracts";

export type ExecutionStateLabel = "LIVE" | "RECORDED" | "FORKED" | "REPLAYED" | "PARTIALLY VERIFIED" | "UNSUPPORTED";

export interface ExecutionState {
  label: ExecutionStateLabel;
  detail: string;
}

export function deriveExecutionStates(artifact: Pick<RunArtifact, "execution" | "lineage" | "provenance">, replays: ReplayResult[]): ExecutionState[] {
  const states: ExecutionState[] = [];
  const fork = artifact.provenance.metadata?.["fork"] as { resumed?: boolean; adapter?: { adapter_id: string; adapter_version: string } } | undefined;

  if (artifact.lineage?.parent_run_id && fork?.resumed) {
    states.push({
      label: "FORKED",
      detail: `Resumed from checkpoint ${artifact.lineage.fork_checkpoint_id} of ${artifact.lineage.parent_run_id} by ${fork.adapter?.adapter_id}@${fork.adapter?.adapter_version}.`,
    });
  } else if (artifact.execution.status === "running") {
    states.push({ label: "LIVE", detail: "Executing; evidence is arriving." });
  } else {
    states.push({ label: "RECORDED", detail: "Captured execution. Reeprov has not re-executed it." });
  }

  // Only host re-execution can earn REPLAYED; self-checks never do.
  const hostReplays = replays
    .filter((r) => r.host_execution?.kind === "HOST_REEXECUTED")
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));
  const latest = hostReplays[0];
  if (latest) {
    if (latest.status === "MATCHED" && latest.verification === "VERIFIED") {
      states.push({ label: "REPLAYED", detail: `Host re-executed offline; ${latest.boundaries_substituted} recorded calls substituted; output verified.` });
    } else if (latest.status === "MATCHED" && latest.verification === "PARTIALLY_VERIFIED") {
      states.push({ label: "PARTIALLY VERIFIED", detail: latest.limitations.find((l) => !l.startsWith("Network")) ?? "Some evidence matched only after redaction." });
    } else if (latest.status === "UNSUPPORTED") {
      states.push({ label: "UNSUPPORTED", detail: latest.divergences[0]?.message ?? latest.limitations[0] ?? "Replay refused." });
    }
  }
  return states;
}
