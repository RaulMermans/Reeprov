"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { WorkflowGallery } from "@/components/proof-layer/WorkflowGallery";
import { RegistryWorkflowCard } from "@/components/dashboard/RegistryWorkflowCard";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import type { WorkflowGalleryItem } from "@/lib/proof-layer/examples";
import type { SavedWorkflowSummary } from "@/lib/workflows/workflowTypes";

interface Props {
  exampleItems: WorkflowGalleryItem[];
}

type StatusFilter = "all" | "active" | "needs_review" | "draft" | "archived";
type SourceFilter = "all" | "scan_reconstruction" | "example" | "manual" | "runtime_observed";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "needs_review", label: "Needs review" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
];

const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: "all", label: "All sources" },
  { key: "scan_reconstruction", label: "Reconstructed" },
  { key: "example", label: "Example" },
  { key: "manual", label: "Manual" },
  { key: "runtime_observed", label: "Runtime" },
];

export function WorkflowsPageClient({ exampleItems }: Props) {
  const { onUnauthorized } = useDashboardAuth();
  const [registered, setRegistered] = useState<SavedWorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  useEffect(() => {
    void loadRegistered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRegistered() {
    setLoading(true);
    try {
      const res = await fetch("/api/workflows", {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) return;
      const data = await res.json() as { workflows: SavedWorkflowSummary[] };
      setRegistered(data.workflows ?? []);
    } catch {
      // silently fail — registry is optional
    } finally {
      setLoading(false);
    }
  }

  const filtered = registered.filter((wf) => {
    if (statusFilter !== "all" && wf.status !== statusFilter) return false;
    if (sourceFilter !== "all" && wf.source !== sourceFilter) return false;
    return true;
  });

  const needsReviewCount = registered.filter((wf) => wf.status === "needs_review").length;

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">

      {/* ── Registered Workflows ── */}
      <section>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Workflow Registry</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Known workflow contracts promoted from scan reconstructions, manually authored, or observed at runtime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              {loading ? "…" : registered.length} registered
            </Badge>
            {needsReviewCount > 0 ? (
              <Badge tone="warning">{needsReviewCount} needs review</Badge>
            ) : null}
          </div>
        </div>

        {/* Filter row */}
        {!loading && registered.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by status">
              <span className="text-xs font-medium text-slate-500">Status:</span>
              {STATUS_FILTERS.map(({ key, label }) => {
                const count = key === "all" ? registered.length : registered.filter((wf) => wf.status === key).length;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusFilter(key)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                      statusFilter === key
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                    data-testid={`status-filter-${key}`}
                  >
                    {label}{count > 0 && key !== "all" ? ` (${count})` : ""}
                  </button>
                );
              })}
            </div>
            <div className="h-4 w-px bg-slate-200" />
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by source">
              <span className="text-xs font-medium text-slate-500">Source:</span>
              {SOURCE_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSourceFilter(key)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                    sourceFilter === key
                      ? "bg-slate-800 text-white"
                      : "text-slate-600 hover:bg-slate-200"
                  }`}
                  data-testid={`source-filter-${key}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <Card className="mt-4 p-6 text-sm text-slate-500">Loading registry…</Card>
        ) : registered.length === 0 ? (
          <Card className="mt-4 border-dashed p-6">
            <p className="text-sm font-medium text-slate-700">No registered workflows yet.</p>
            <p className="mt-2 text-xs text-slate-500">
              Promote a reconstructed spec from{" "}
              <Link href="/dashboard/reports" className="text-teal-700 hover:underline">Scan History</Link>{" "}
              or from the{" "}
              <Link href="/dashboard/scanner" className="text-teal-700 hover:underline">Repository Scanner</Link>{" "}
              after generating a proof spec. Example workflows are shown below.
            </p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="mt-4 p-6 text-sm text-slate-500">
            No workflows match the selected filters.{" "}
            <button
              type="button"
              className="text-teal-700 hover:underline"
              onClick={() => { setStatusFilter("all"); setSourceFilter("all"); }}
            >
              Clear filters
            </button>
          </Card>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((wf) => (
              <RegistryWorkflowCard key={wf.registryId} workflow={wf} />
            ))}
          </div>
        )}
      </section>

      {/* ── Example Workflows ── */}
      <section>
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-slate-950">Example Workflows</h2>
          <Badge tone="neutral">static demo data</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Static demo workflows — not live ingestion and not registered contracts. Use these to explore the proof-layer inspector.
        </p>
        <div className="mt-4">
          <WorkflowGallery items={exampleItems} />
        </div>
      </section>

    </main>
  );
}
