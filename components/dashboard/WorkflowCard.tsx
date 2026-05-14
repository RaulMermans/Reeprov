import { GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DetectedWorkflow } from "@/lib/scanner/types";

const typeLabels: Record<NonNullable<DetectedWorkflow["type"]>, string> = {
  deterministic_workflow: "Deterministic",
  workflow_with_tools: "With tools",
  hybrid_workflow_agent: "Hybrid",
  unknown: "Unknown type",
};

export function WorkflowCard({ workflow }: { workflow: DetectedWorkflow }) {
  const isInferred = workflow.source === "inferred";
  const isLowConfidence = workflow.confidence === "low";

  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-slate-950">{workflow.name}</div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {isInferred ? (
                <Badge tone={isLowConfidence ? "warning" : "neutral"}>
                  {isLowConfidence ? "Low confidence" : "Inferred"}
                </Badge>
              ) : (
                <Badge tone="success">Explicit</Badge>
              )}
            </div>
          </div>
          {workflow.type ? (
            <div className="mt-0.5 text-xs text-slate-500">{typeLabels[workflow.type]}</div>
          ) : null}
          {workflow.configPath ? (
            <div className="mt-1 text-xs text-slate-500">{workflow.configPath}</div>
          ) : null}
          {workflow.stages && workflow.stages.length > 0 ? (
            <div className="mt-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Stages</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {workflow.stages.map((stage) => (
                  <span
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                    key={stage}
                  >
                    {stage}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {workflow.tools && workflow.tools.length > 0 ? (
            <div className="mt-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Tools</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {workflow.tools.map((tool) => (
                  <span
                    className="rounded bg-teal-50 px-1.5 py-0.5 text-xs text-teal-800"
                    key={tool}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {workflow.risks && workflow.risks.length > 0 ? (
            <div className="mt-2 text-xs text-amber-700">{workflow.risks.join(" ")}</div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
