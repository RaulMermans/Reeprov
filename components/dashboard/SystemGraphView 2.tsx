import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type {
  SystemGraph,
  SystemGraphNode,
  SystemGraphNodeType,
} from "@/lib/scanner/types";

const NODE_CAP = 12;

const COLUMNS: ReadonlyArray<{
  title: string;
  types: SystemGraphNodeType[];
}> = [
  { title: "Workflows / Steps", types: ["workflow", "workflow_step"] },
  { title: "Agents", types: ["agent"] },
  { title: "Prompts / Tools / Models", types: ["prompt", "tool", "model", "provider"] },
  { title: "Evals / Artifacts / Gates", types: ["eval", "approval_gate", "artifact", "data_source", "external_side_effect"] },
];

const TYPE_LABEL: Record<SystemGraphNodeType, string> = {
  agent: "Agent",
  workflow: "Workflow",
  workflow_step: "Step",
  prompt: "Prompt",
  tool: "Tool",
  model: "Model",
  provider: "Provider",
  eval: "Eval",
  data_source: "Data source",
  approval_gate: "Approval gate",
  artifact: "Artifact",
  external_side_effect: "Side effect",
  assistant_tooling: "Assistant tooling",
  unknown: "Unknown",
};

const TYPE_TONE: Record<SystemGraphNodeType, "neutral" | "success" | "warning" | "info" | "danger"> = {
  agent: "success",
  workflow: "info",
  workflow_step: "info",
  prompt: "neutral",
  tool: "neutral",
  model: "info",
  provider: "neutral",
  eval: "warning",
  data_source: "neutral",
  approval_gate: "warning",
  artifact: "neutral",
  external_side_effect: "danger",
  assistant_tooling: "neutral",
  unknown: "neutral",
};

export function SystemGraphView({ graph }: { graph: SystemGraph }) {
  if (!graph || graph.nodes.length === 0) {
    return (
      <Card className="p-5 text-sm text-slate-600">
        No system graph reconstructed yet. Add agents.yaml or workflow.yaml with prompts, tools, evals, and model/provider mappings to populate the graph.
      </Card>
    );
  }

  const groupedNodes = COLUMNS.map((col) => ({
    title: col.title,
    nodes: graph.nodes.filter((n) => col.types.includes(n.type)),
  }));

  const s = graph.summary;

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            AI System Graph
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Reconstructed from manifests and static signals. Detected ≠ mapped.
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 sm:mt-0">
          <Badge tone="success">{s.agentCount} agents</Badge>
          <Badge tone="info">{s.workflowCount} workflows</Badge>
          <Badge tone="neutral">{s.modelCount} models</Badge>
          <Badge tone="warning">{s.evalCount} evals</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        {groupedNodes.map((col) => (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3" key={col.title}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {col.title}
              <span className="ml-1 font-normal text-slate-400">({col.nodes.length})</span>
            </div>
            <ul className="space-y-2">
              {col.nodes.slice(0, NODE_CAP).map((node) => (
                <li key={node.id}>
                  <NodeCard node={node} />
                </li>
              ))}
              {col.nodes.length === 0 ? (
                <li className="text-xs text-slate-400">None</li>
              ) : null}
              {col.nodes.length > NODE_CAP ? (
                <li className="text-xs text-slate-500">
                  +{col.nodes.length - NODE_CAP} more
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <div>Mapped agents: <span className="font-medium text-slate-900">{s.mappedAgentCount}</span></div>
        <div>Unmapped agents: <span className="font-medium text-slate-900">{s.unmappedAgentCount}</span></div>
        <div>Missing prompt links: <span className="font-medium text-slate-900">{s.missingPromptLinks}</span></div>
        <div>Missing tool links: <span className="font-medium text-slate-900">{s.missingToolLinks}</span></div>
        <div>Missing eval links: <span className="font-medium text-slate-900">{s.missingEvalLinks}</span></div>
        <div>Missing model links: <span className="font-medium text-slate-900">{s.missingModelLinks}</span></div>
      </div>
    </Card>
  );
}

function NodeCard({ node }: { node: SystemGraphNode }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-2 py-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="break-all text-xs font-medium text-slate-900">{node.label}</div>
          {node.sourcePath && node.sourcePath !== node.label ? (
            <div className="mt-0.5 break-all font-mono text-[10px] text-slate-500">{node.sourcePath}</div>
          ) : null}
        </div>
        <Badge tone={TYPE_TONE[node.type]} className="shrink-0">
          {TYPE_LABEL[node.type]}
        </Badge>
      </div>
      {node.confidence && node.confidence !== "high" ? (
        <div className="mt-1 text-[10px] text-amber-700">{node.confidence} confidence</div>
      ) : null}
    </div>
  );
}
