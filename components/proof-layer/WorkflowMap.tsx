import type { StageStatus, WorkflowMapNode } from "@/lib/runs/runIntelligence";

const STATUS_STYLES: Record<StageStatus | "not_observed", { dot: string; ring: string; text: string; label: string }> = {
  completed: { dot: "bg-emerald-500", ring: "ring-emerald-200", text: "text-emerald-700", label: "Completed" },
  warning: { dot: "bg-amber-400", ring: "ring-amber-200", text: "text-amber-700", label: "Warning / recovered" },
  failed: { dot: "bg-red-500", ring: "ring-red-200", text: "text-red-700", label: "Failed" },
  running: { dot: "bg-sky-500", ring: "ring-sky-200", text: "text-sky-700", label: "In progress" },
  skipped: { dot: "bg-slate-300", ring: "ring-slate-200", text: "text-slate-500", label: "Skipped" },
  not_observed: { dot: "bg-slate-300", ring: "ring-slate-200", text: "text-slate-500", label: "Not observed" },
};

/**
 * Visual pipeline map: a horizontal sequence of stage chips colored by
 * status, connected by arrows. Wraps to a vertical flow on small screens.
 */
export function WorkflowMap({ nodes }: { nodes: WorkflowMapNode[] }) {
  if (!nodes.length) {
    return (
      <p className="text-sm text-slate-500">No workflow stages observed yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-2" data-testid="workflow-map">
        {nodes.map((node, index) => {
          const style = STATUS_STYLES[node.status];
          return (
            <div key={node.id} className="flex items-center gap-2">
              <div
                className={`flex min-w-[9rem] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm ring-1 ${style.ring}`}
                data-testid={`workflow-map-node-${node.id}`}
                data-status={node.status}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-900">{node.label}</p>
                  <p className={`text-[11px] ${style.text}`}>{style.label}</p>
                </div>
              </div>
              {index < nodes.length - 1 ? (
                <span className="text-slate-300" aria-hidden="true">→</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        {(Object.keys(STATUS_STYLES) as Array<StageStatus | "not_observed">)
          .filter((key) => key !== "skipped")
          .map((key) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[key].dot}`} aria-hidden="true" />
              {STATUS_STYLES[key].label}
            </span>
          ))}
      </div>
    </div>
  );
}
