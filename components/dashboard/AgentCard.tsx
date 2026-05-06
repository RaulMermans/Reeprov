import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DetectedAgent } from "@/lib/scanner/types";

export function AgentCard({ agent }: { agent: DetectedAgent }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{agent.name}</h3>
          {agent.configPath ? (
            <p className="mt-1 text-sm text-slate-600">{agent.configPath}</p>
          ) : null}
        </div>
        <Badge tone={agent.risks.length > 0 ? "warning" : "success"}>
          {agent.risks.length > 0 ? "Review" : "Mapped"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-700">
        <div>Prompts: {agent.promptPaths.length}</div>
        <div>Tools: {agent.toolNames.length}</div>
        <div>Evals: {agent.evalPaths.length}</div>
      </div>
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
