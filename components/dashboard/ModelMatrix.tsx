import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type {
  DetectedAgent,
  DetectedModelConfig,
  DetectedModelPerformance,
} from "@/lib/scanner/types";

interface ModelMatrixRow {
  target: string;
  provider: string;
  model: string;
  source: DetectedModelConfig["source"];
  confidence: DetectedModelConfig["confidence"];
  evalCoverage: string;
  performance: string;
}

export function ModelMatrix({
  agents,
  models,
  performance,
}: {
  agents: DetectedAgent[];
  models?: DetectedModelConfig[];
  performance?: DetectedModelPerformance[];
}) {
  if (!models || models.length === 0) {
    return (
      <Card className="p-5 text-sm text-slate-600">
        No provider/model mapping detected. Add model.provider and model.name to agents.yaml or workflow.yaml.
      </Card>
    );
  }

  const rows: ModelMatrixRow[] = models.map((m) => {
    const mappedAgent = m.mappedAgentIds?.[0];
    const agent = agents.find((a) => a.id === mappedAgent);
    const target = agent
      ? agent.name
      : mappedAgent
        ? mappedAgent
        : "Unmapped";
    const evalCoverage = agent?.evalPaths.length ? "mapped" : "not mapped";
    const hasPerf = (performance ?? []).some(
      (p) =>
        p.provider === m.provider &&
        (m.model ? p.model === m.model : false),
    );
    return {
      target,
      provider: m.provider,
      model: m.model ?? "provider detected",
      source: m.source,
      confidence: m.confidence,
      evalCoverage,
      performance: hasPerf ? "available" : "unavailable",
    };
  });

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Model / Provider Matrix
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Provider and model metadata detected from manifests, code, env, and imports.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-3">Agent / Step</th>
              <th className="py-2 pr-3">Provider</th>
              <th className="py-2 pr-3">Model</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">Confidence</th>
              <th className="py-2 pr-3">Eval coverage</th>
              <th className="py-2 pr-3">Performance data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, idx) => (
              <tr key={`${row.target}-${row.provider}-${row.model}-${idx}`}>
                <td className="py-2 pr-3 font-medium text-slate-900">{row.target}</td>
                <td className="py-2 pr-3 capitalize text-slate-700">{row.provider}</td>
                <td className="py-2 pr-3 font-mono text-slate-700">{row.model}</td>
                <td className="py-2 pr-3 text-slate-600">{row.source}</td>
                <td className="py-2 pr-3">
                  <Badge tone={confidenceTone(row.confidence)}>{row.confidence}</Badge>
                </td>
                <td className="py-2 pr-3 text-slate-600">{row.evalCoverage}</td>
                <td className="py-2 pr-3 text-slate-600">{row.performance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!performance || performance.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Performance unavailable. Add eval result files with provider, model, score, tokens, latency, and cost to compare models.
        </p>
      ) : null}
    </Card>
  );
}

function confidenceTone(c: "high" | "medium" | "low") {
  if (c === "high") return "success" as const;
  if (c === "medium") return "info" as const;
  return "warning" as const;
}
