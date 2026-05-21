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
      if (confidence === "low") return <Badge tone="warning">Low confidence</Badge>;
      if (confidence === "high") return <Badge tone="success">Explicit</Badge>;
      return <Badge tone="neutral">Inferred</Badge>;
  }
}

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
          {agent.owner ? (
            <p className="mt-0.5 text-xs text-slate-500">Owner: {agent.owner}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {agentBadge(agent.displayKind, agent.confidence)}
          {showReview ? <Badge tone="warning">Review</Badge> : null}
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-700">
        {mapped ? (
          <>
            <MappedField label="Prompts" values={agent.promptPaths} />
            <MappedField label="Tools" values={agent.toolNames} />
            <MappedField label="Evals" values={agent.evalPaths} />
            <ModelField agent={agent} />
          </>
        ) : (
          <>
            <div className="text-slate-400">Prompt links: Not mapped</div>
            <div className="text-slate-400">Tool links: Not mapped</div>
            <div className="text-slate-400">Eval links: Not mapped</div>
            <div className="text-slate-400">Model: Not mapped</div>
          </>
        )}
      </div>

      {agent.permissions ? (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {agent.permissions.externalNetwork !== undefined ? (
            <Badge tone={agent.permissions.externalNetwork ? "warning" : "neutral"}>
              external_network: {String(agent.permissions.externalNetwork)}
            </Badge>
          ) : null}
          {agent.permissions.writeFiles !== undefined ? (
            <Badge tone={agent.permissions.writeFiles ? "warning" : "neutral"}>
              write_files: {String(agent.permissions.writeFiles)}
            </Badge>
          ) : null}
          {agent.permissions.publish !== undefined ? (
            <Badge tone={agent.permissions.publish ? "warning" : "neutral"}>
              publish: {String(agent.permissions.publish)}
            </Badge>
          ) : null}
        </div>
      ) : null}

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

function MappedField({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) {
    return <div className="text-slate-400">{label}: Not mapped</div>;
  }
  return (
    <div>
      <span className="text-slate-700">{label}:</span>{" "}
      <span className="text-slate-900">{values.length}</span>
      <ul className="mt-1 space-y-0.5 pl-3 text-xs text-slate-600">
        {values.slice(0, 4).map((v) => (
          <li className="break-all font-mono" key={v}>
            {v}
          </li>
        ))}
        {values.length > 4 ? <li className="text-slate-400">+{values.length - 4} more</li> : null}
      </ul>
    </div>
  );
}

function ModelField({ agent }: { agent: DetectedAgent }) {
  if (!agent.model) {
    return <div className="text-slate-400">Model: Not mapped</div>;
  }
  return (
    <div>
      <span className="text-slate-700">Model:</span>{" "}
      <span className="font-mono text-xs text-slate-900">
        {agent.model.provider}
        {agent.model.name ? ` / ${agent.model.name}` : ""}
      </span>
      {agent.model.temperature !== undefined ? (
        <span className="ml-2 text-xs text-slate-500">temp {agent.model.temperature}</span>
      ) : null}
    </div>
  );
}
