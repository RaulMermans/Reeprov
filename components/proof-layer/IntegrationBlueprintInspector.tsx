/**
 * Aggregate inspector for a single Integration Workflow Blueprint node.
 *
 * Unlike the run-detail NodeDetailPanel (which inspects one run's raw
 * events), this shows aggregate evidence across the sampled run window:
 * how often the node was observed, its status mix, related stages (for
 * evidence nodes), and links to example runs. No raw trace events, no raw
 * prompts/outputs — only the short, pre-truncated summaries the blueprint
 * builder already produced.
 */

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { visualNodeTypeDefinition } from "@/lib/visualGraph/nodeRegistry";
import type { IntegrationBlueprintNode } from "@/lib/integrations/integrationBlueprintTypes";

function formatDateTime(iso?: string): string {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function humanizeLabel(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export interface IntegrationBlueprintInspectorProps {
  node: IntegrationBlueprintNode;
  /** Resolves a node id to its display label, for "related stages" links. */
  labelForNodeId?: (id: string) => string | undefined;
  onClose: () => void;
}

export function IntegrationBlueprintInspector({ node, labelForNodeId, onClose }: IntegrationBlueprintInspectorProps) {
  const typeDef = visualNodeTypeDefinition(node.type);
  const Icon = typeDef.icon;
  const { statusSummary } = node;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border p-1.5 ${typeDef.bgClass} ${typeDef.borderClass}`}>
            <Icon className={`h-4 w-4 ${typeDef.accentClass}`} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{node.label}</p>
            <p className="text-xs text-slate-400">
              {typeDef.label} · {node.role === "primary" ? "Workflow stage" : "Attached evidence"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          Close
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs font-medium text-slate-400">Observed</dt>
          <dd className="mt-0.5 text-slate-800">{statusSummary.observedRuns} of sampled runs</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-400">Completed</dt>
          <dd className="mt-0.5 text-emerald-700">{statusSummary.completedRuns}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-400">Warning / Failed</dt>
          <dd className="mt-0.5 text-amber-700">
            {statusSummary.warningRuns} / <span className="text-red-700">{statusSummary.failedRuns}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-400">Recovered</dt>
          <dd className="mt-0.5 text-emerald-700">{statusSummary.recoveredRuns}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-400">Last seen</dt>
          <dd className="mt-0.5 text-slate-600">{formatDateTime(node.lastSeenAt)}</dd>
        </div>
      </dl>

      {node.role === "evidence" && node.parentIds && node.parentIds.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">Related stages</h3>
          <div className="flex flex-wrap gap-1.5">
            {node.parentIds.map((id) => (
              <Badge key={id} tone="neutral">{labelForNodeId?.(id) ?? humanizeLabel(id)}</Badge>
            ))}
          </div>
        </div>
      )}

      {node.commonMetadata && Object.keys(node.commonMetadata).length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">Metadata</h3>
          <dl className="space-y-1 text-xs text-slate-600">
            {Object.entries(node.commonMetadata).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="font-medium text-slate-400">{humanizeLabel(key)}:</dt>
                <dd className="truncate">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold text-slate-600">Example runs</h3>
        {node.examples.length === 0 ? (
          <p className="text-xs text-slate-400">No example runs recorded in the sampled window.</p>
        ) : (
          <ul className="space-y-1.5">
            {node.examples.map((example) => (
              <li key={`${example.runId}-${example.eventId ?? ""}`}>
                <Link
                  href={`/dashboard/runs/${example.runId}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-1.5 text-xs hover:border-teal-200 hover:bg-slate-50"
                >
                  <span className="font-mono text-slate-400">{example.runId}</span>
                  {example.summary && <span className="min-w-0 flex-1 truncate text-right text-slate-600">{example.summary}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
