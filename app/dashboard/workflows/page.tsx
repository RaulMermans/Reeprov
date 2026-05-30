"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { WorkflowGallery } from "@/components/proof-layer/WorkflowGallery";
import { RegistryWorkflowCard } from "@/components/dashboard/RegistryWorkflowCard";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { getWorkflowGalleryItems } from "@/lib/proof-layer/examples";
import type { SavedWorkflowSummary } from "@/lib/workflows/workflowTypes";

export default function WorkflowsPage() {
  const { onUnauthorized } = useDashboardAuth();
  const [registered, setRegistered] = useState<SavedWorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const exampleItems = getWorkflowGalleryItems();

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
          <Badge tone="neutral">
            {loading ? "…" : registered.length} registered
          </Badge>
        </div>

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
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {registered.map((wf) => (
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
