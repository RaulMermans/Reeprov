import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { AgentDisplayKind, DetectedAgent } from "@/lib/scanner/types";

function agentBadge(kind: AgentDisplayKind | undefined, confidence: DetectedAgent["confidence"]) {
  switch (kind) {
    case "manifest":
      return <Badge tone="success">Explicit manifest</Badge>;
    case "agent_file":
      return <Badge tone="neutral">Agent file</Badge>;
    case "inferred_candidate":
      return <Badge tone="warning">Inferred candidate</Badge>;
    default:
      // Fallback for legacy data without displayKind.
      if (confidence === "low") return <Badge tone="warning">Low confidence</Badge>;
      if (confidence === "high") return <Badge tone="success">Explicit</Badge>;
      return <Badge tone="neutral">Inferred</Badge>;
  }
}

// Only manifest agents have reliably mapped prompts/tools/evals.
function isMappedAgent(agent: DetectedAgent): boolean {
  return agent.displayKind === "manifest" || (agent.source === "explicit" && !agent.displayKind);
}

export function AgentCard({ agent }: { agent: DetectedAgent }) {
  const mapped = isMappedAgent(agent);
  const showReview = agent.risks.length > 0 && agent.displayKind !== "inferred_candidate";

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{agent.name}</h3>
          {agent.configPath ? (
            <p className="mt-1 text-sm text-slate-600">{agent.configPath}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {agentBadge(agent.displayKind, agent.confidence)}
          {showReview ? <Badge tone="warning">Review</Badge> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-700">
        {mapped ? (
          // Manifest agents: show mapped counts from config.
          <>
            <div>Prompts: {agent.promptPaths.length}</div>
            <div>Tools: {agent.toolNames.length}</div>
            <div>Evals: {agent.evalPaths.length}</div>
          </>
        ) : (
          // Agent file or inferred: no manifest mapping.
          <>
            <div className="text-slate-400">Prompt links: Not mapped</div>
            <div className="text-slate-400">Tool links: Not mapped</div>
            <div className="text-slate-400">Eval links: Not mapped</div>
          </>
        )}
      </div>

      {agent.evidenceReason ? (
        <p className="mt-3 text-xs text-slate-500">{agent.evidenceReason}</p>
      ) : null}

      {agent.risks.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-amber-800">
          {agent.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
