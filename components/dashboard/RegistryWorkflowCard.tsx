"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { SavedWorkflowSummary } from "@/lib/workflows/workflowTypes";

function sourceTone(source: string): "success" | "warning" | "neutral" | "info" {
  if (source === "scan_reconstruction") return "info";
  if (source === "manual") return "warning";
  if (source === "example") return "neutral";
  return "neutral";
}

function statusTone(status: string): "success" | "warning" | "neutral" | "danger" {
  if (status === "active") return "success";
  if (status === "needs_review") return "warning";
  if (status === "draft") return "neutral";
  if (status === "archived") return "danger";
  return "neutral";
}

function confidenceTone(c: string): "success" | "warning" | "neutral" {
  if (c === "high") return "success";
  if (c === "medium") return "warning";
  return "neutral";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function RegistryWorkflowCard({ workflow }: { workflow: SavedWorkflowSummary }) {
  return (
    <Link href={`/dashboard/workflows/registry/${workflow.registryId}`}>
      <Card className="h-full p-5 transition hover:border-teal-300 hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-950">{workflow.name}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{workflow.projectName}</p>
          </div>
          <Badge tone={statusTone(workflow.status)}>{workflow.status}</Badge>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={sourceTone(workflow.source)}>{workflow.source.replace("_", " ")}</Badge>
          <Badge tone={confidenceTone(workflow.confidence)}>{workflow.confidence}</Badge>
          <Badge tone="neutral">{workflow.architectureType.replace(/_/g, " ")}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <dt className="font-medium uppercase text-slate-400">Nodes</dt>
            <dd className="mt-0.5 text-slate-800">{workflow.nodeCount}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase text-slate-400">Edges</dt>
            <dd className="mt-0.5 text-slate-800">{workflow.edgeCount}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase text-slate-400">Tools</dt>
            <dd className="mt-0.5 text-slate-800">{workflow.toolCount || "—"}</dd>
          </div>
          <div>
            <dt className="font-medium uppercase text-slate-400">Evals</dt>
            <dd className="mt-0.5 text-slate-800">{workflow.evalCount || "—"}</dd>
          </div>
          {workflow.missingFieldCount > 0 ? (
            <div className="col-span-2">
              <dt className="font-medium uppercase text-slate-400">Missing fields</dt>
              <dd className="mt-0.5 text-amber-700">{workflow.missingFieldCount}</dd>
            </div>
          ) : null}
        </dl>

        <p className="mt-3 text-xs text-slate-400">Updated {formatDate(workflow.updatedAt)}</p>
      </Card>
    </Link>
  );
}
