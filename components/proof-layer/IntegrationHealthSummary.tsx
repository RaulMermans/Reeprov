/**
 * Aggregate health summary card for the Integration Workflow Blueprint.
 *
 * Purely presentational — renders the IntegrationHealthSummary + runWindow
 * already computed by buildIntegrationBlueprint. Never invents metrics: an
 * unavailable field renders as "—", not a fabricated number.
 */

import { Card } from "@/components/ui/Card";
import type { IntegrationHealthSummary as IntegrationHealthSummaryData } from "@/lib/integrations/integrationBlueprintTypes";

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

interface StatProps {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
}

const TONE_CLASS: Record<NonNullable<StatProps["tone"]>, string> = {
  neutral: "text-slate-900",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-red-700",
};

function Stat({ label, value, tone = "neutral" }: StatProps) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold ${TONE_CLASS[tone]}`}>{value}</dd>
    </div>
  );
}

export interface IntegrationHealthSummaryProps {
  health: IntegrationHealthSummaryData;
}

export function IntegrationHealthSummary({ health }: IntegrationHealthSummaryProps) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-800">Recent Run Health</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Sampled runs" value={health.runCount} />
        <Stat label="Completed" value={health.completedCount} tone={health.completedCount > 0 ? "success" : "neutral"} />
        <Stat label="Degraded" value={health.degradedCount} tone={health.degradedCount > 0 ? "warning" : "neutral"} />
        <Stat label="Failed" value={health.failedCount} tone={health.failedCount > 0 ? "danger" : "neutral"} />
        <Stat label="Recovered" value={health.recoveredCount} tone={health.recoveredCount > 0 ? "success" : "neutral"} />
        <Stat label="Last run" value={formatDateTime(health.lastRunAt)} />
      </dl>
      <p className="mt-3 text-xs text-slate-400">Last event received: {formatDateTime(health.lastEventAt)}</p>

      {health.commonFailureModes.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">Common failure modes</h3>
          <ul className="space-y-1.5">
            {health.commonFailureModes.map((mode) => (
              <li key={mode.label} className="flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800">
                <span className="min-w-0 flex-1 truncate">{mode.label}</span>
                <span className="shrink-0 font-mono text-red-600">×{mode.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
