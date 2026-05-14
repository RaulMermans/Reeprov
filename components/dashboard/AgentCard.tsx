import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DetectedAgent } from "@/lib/scanner/types";

export function AgentCard({ agent }: { agent: DetectedAgent }) {
  const isInferred = agent.source === "inferred";
  const isLowConfidence = agent.confidence === "low";

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
          {isInferred ? (
            <Badge tone={isLowConfidence ? "warning" : "neutral"}>
              {isLowConfidence ? "Low confidence" : "Inferred"}
            </Badge>
          ) : (
            <Badge tone="success">Explicit</Badge>
          )}
          {agent.risks.length > 0 && !isInferred ? (
            <Badge tone="warning">Review</Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-slate-700">
        {isInferred && !agent.configPath ? (
          // Inferred agents without a manifest: don't attribute repo-level counts.
          <>
            <div className="text-slate-400">Prompt links: Not mapped</div>
            <div className="text-slate-400">Tool links: Not mapped</div>
            <div className="text-slate-400">Eval links: Not mapped</div>
          </>
        ) : (
          <>
            <div>Prompts: {agent.promptPaths.length}</div>
            <div>Tools: {agent.toolNames.length}</div>
            <div>Evals: {agent.evalPaths.length}</div>
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
