"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ConnectAgentWizard } from "@/components/projects/ConnectAgentWizard";
import { FirstLaunchOnboarding } from "@/components/projects/FirstLaunchOnboarding";
import type { Project } from "@/lib/projects/projectTypes";
import type { CaptureReadinessReport } from "@/lib/projects/captureReadiness";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [readinessModal, setReadinessModal] = useState<{
    project: Project;
    report: CaptureReadinessReport;
  } | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    projectId: string;
    projectName: string;
    runsCount: number;
    confirmationInput: string;
    error?: string;
  } | null>(null);

  async function fetchProjects() {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = (await res.json()) as { projects: Project[] };
        setProjects(data.projects || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchProjects();
  }, []);

  async function handleOpenReadiness(project: Project) {
    setLoadingReadiness(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/readiness`);
      if (res.ok) {
        const data = (await res.json()) as { readiness: CaptureReadinessReport };
        setReadinessModal({ project, report: data.readiness });
      }
    } catch {
      // ignore
    } finally {
      setLoadingReadiness(false);
    }
  }

  async function handleExport(projectId: string) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/export`);
      if (res.ok) {
        const bundle = await res.json();
        const blob = new Blob([JSON.stringify(bundle, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectId}-export.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert("Failed to export project bundle.");
    }
  }

  async function handleOpenDelete(projectId: string, projectName: string) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/delete-preview`);
      if (res.ok) {
        const preview = (await res.json()) as { runsCount: number };
        setDeleteModal({
          projectId,
          projectName,
          runsCount: preview.runsCount,
          confirmationInput: "",
        });
      }
    } catch {
      // fallback
      setDeleteModal({
        projectId,
        projectName,
        runsCount: 0,
        confirmationInput: "",
      });
    }
  }

  async function handleConfirmDelete() {
    if (!deleteModal) return;

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(deleteModal.projectId)}?confirmation=${encodeURIComponent(
          deleteModal.confirmationInput
        )}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteModal({
          ...deleteModal,
          error: data.error || "Confirmation did not match project identifier.",
        });
        return;
      }

      setDeleteModal(null);
      void fetchProjects();
    } catch {
      setDeleteModal({
        ...deleteModal,
        error: "Failed to delete project.",
      });
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-teal-200 border-t-teal-700 mb-3" />
        Loading local projects...
      </div>
    );
  }

  // First-launch empty state
  if (projects.length === 0) {
    return (
      <FirstLaunchOnboarding
        onDemoLoaded={() => void fetchProjects()}
        onProjectCreated={() => void fetchProjects()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-950">Projects</h1>
          <p className="mt-1 text-xs text-slate-500">
            Local AI agent projects and execution environments.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-teal-800 transition"
          >
            + Connect Agent
          </button>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.map((p) => {
          const isDemo = p.id === "demo-support-agent" || p.id.startsWith("demo-");

          return (
            <div
              key={p.id}
              className={`rounded-2xl border bg-white p-5 shadow-xs transition hover:shadow-md flex flex-col justify-between ${
                isDemo ? "border-teal-200 bg-gradient-to-b from-teal-50/20 to-white" : "border-slate-200"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold text-slate-950 truncate">{p.name}</h2>
                      {isDemo && (
                        <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 uppercase tracking-wide">
                          DEMO
                        </span>
                      )}
                    </div>
                    <code className="mt-0.5 block font-mono text-[11px] text-slate-400">
                      {p.id}
                    </code>
                  </div>

                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                      p.status === "receiving_events"
                        ? "bg-emerald-50 text-emerald-700"
                        : p.status === "waiting_for_first_event"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        p.status === "receiving_events" ? "bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    {p.status.replace(/_/g, " ")}
                  </span>
                </div>

                <p className="mt-3 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {p.description || "No description provided."}
                </p>

                {/* Metadata & Stats */}
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[11px]">
                  <div>
                    <span className="text-slate-400">Language:</span>{" "}
                    <span className="font-semibold text-slate-700 capitalize">{p.language || "TypeScript"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Framework:</span>{" "}
                    <span className="font-semibold text-slate-700 capitalize">{p.framework || "Custom"}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Total Runs:</span>{" "}
                    <span className="font-semibold text-slate-900">{p.stats?.totalRuns ?? 0}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Last Run:</span>{" "}
                    <span
                      className={`font-semibold capitalize ${
                        p.stats?.lastRunStatus === "completed"
                          ? "text-emerald-700"
                          : p.stats?.lastRunStatus === "failed"
                          ? "text-red-700"
                          : "text-slate-600"
                      }`}
                    >
                      {p.stats?.lastRunStatus || "None"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenReadiness(p)}
                    className="rounded px-2 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-50 transition"
                  >
                    Quality Score
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExport(p.id)}
                    className="rounded px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 transition"
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenDelete(p.id, p.name)}
                    className="rounded px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 transition"
                  >
                    Delete
                  </button>
                </div>

                <Link
                  href={`/dashboard/runs?projectId=${encodeURIComponent(p.id)}`}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition"
                >
                  Runs →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* Connect Agent Wizard Modal */}
      <ConnectAgentWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onProjectCreated={() => void fetchProjects()}
      />

      {/* Capture Readiness Modal */}
      {readinessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-950">Capture Quality Report</h3>
                <p className="text-xs text-slate-500">{readinessModal.project.name} ({readinessModal.project.id})</p>
              </div>
              <button
                type="button"
                onClick={() => setReadinessModal(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-4">
              {/* Score card */}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 p-4 border border-slate-200">
                <div>
                  <span className="text-xs font-semibold text-slate-500">Overall Diagnostic Quality</span>
                  <div className="text-2xl font-black text-slate-950">
                    {readinessModal.report.overallScore} / 100
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-semibold text-slate-500">Replay Projection</span>
                  <div className="text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 rounded px-2 py-1 mt-0.5 font-mono">
                    {readinessModal.report.replayProjection.projectedMode}
                  </div>
                </div>
              </div>

              <div className="text-xs text-slate-600 bg-slate-50/50 p-3 rounded-lg border border-slate-100 leading-relaxed">
                {readinessModal.report.replayProjection.explanation}
              </div>

              {/* Dimensions list */}
              <div>
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Evidence Coverage</h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {readinessModal.report.dimensions.map((dim, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 p-2 text-xs">
                      <span className="font-medium text-slate-800">{dim.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          dim.level === "COMPLETE"
                            ? "bg-emerald-50 text-emerald-700"
                            : dim.level === "PARTIAL"
                            ? "bg-amber-50 text-amber-700"
                            : dim.level === "NOT_APPLICABLE"
                            ? "bg-slate-100 text-slate-500"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {dim.level}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReadinessModal(null)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-red-950">Delete Project &quot;{deleteModal.projectName}&quot;</h3>
            <p className="mt-2 text-xs text-slate-600 leading-relaxed">
              This action permanently deletes the project record, scoped ingest keys, and all {deleteModal.runsCount} associated execution runs and artifacts.
            </p>

            {deleteModal.error && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                {deleteModal.error}
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700">
                Type <strong>{deleteModal.projectId}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteModal.confirmationInput}
                onChange={(e) =>
                  setDeleteModal({ ...deleteModal, confirmationInput: e.target.value, error: undefined })
                }
                placeholder={deleteModal.projectId}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono focus:border-red-600 focus:outline-none"
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleteModal.confirmationInput.trim() !== deleteModal.projectId}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
