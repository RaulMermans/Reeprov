"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { computeDisplayStatus } from "@/lib/integrations/integrationTypes";
import type { ProjectIntegration, IntegrationLanguage, IntegrationMode } from "@/lib/integrations/integrationTypes";

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "receiving_events") return "success";
  if (status === "stale") return "warning";
  if (status === "error") return "danger";
  return "neutral";
}

function modeTone(mode: string): "success" | "warning" | "danger" | "neutral" {
  if (mode === "trace_sdk") return "success";
  if (mode === "static_only") return "neutral";
  return "neutral";
}

function formatDateTime(iso?: string): string {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function languageLabel(lang?: string): string {
  if (lang === "typescript") return "TypeScript";
  if (lang === "python") return "Python";
  if (lang === "other") return "Other";
  return "—";
}

// ── Add Integration modal form ────────────────────────────────────────────────

interface AddFormState {
  projectId: string;
  projectName: string;
  description: string;
  defaultWorkflowId: string;
  repositoryUrl: string;
  language: IntegrationLanguage | "";
  framework: string;
  mode: IntegrationMode;
}

function AddIntegrationForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (integration: ProjectIntegration) => void;
}) {
  const { onUnauthorized } = useDashboardAuth();
  const [form, setForm] = useState<AddFormState>({
    projectId: "",
    projectName: "",
    description: "",
    defaultWorkflowId: "",
    repositoryUrl: "",
    language: "",
    framework: "",
    mode: "trace_sdk",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField<K extends keyof AddFormState>(key: K, value: AddFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectId.trim() || !form.projectName.trim()) {
      setError("Project ID and Project Name are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        projectId: form.projectId.trim(),
        projectName: form.projectName.trim(),
        mode: form.mode,
      };
      if (form.description.trim()) body["description"] = form.description.trim();
      if (form.defaultWorkflowId.trim()) body["defaultWorkflowId"] = form.defaultWorkflowId.trim();
      if (form.repositoryUrl.trim()) body["repositoryUrl"] = form.repositoryUrl.trim();
      if (form.language) body["language"] = form.language;
      if (form.framework.trim()) body["framework"] = form.framework.trim();

      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...mergeAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Failed to create integration.");
        return;
      }
      const data = await res.json() as ProjectIntegration;
      onCreated(data);
    } catch {
      setError("Could not connect to AgentPulse. Is the dev server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-950">Add Integration</h2>
          <button onClick={onClose} type="button" className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Project Name <span className="text-red-500">*</span></span>
              <input
                type="text"
                placeholder="Blog Agent"
                value={form.projectName}
                onChange={(e) => setField("projectName", e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Project ID <span className="text-red-500">*</span></span>
              <input
                type="text"
                placeholder="blog-agent"
                value={form.projectId}
                onChange={(e) => setField("projectId", e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:border-teal-400 focus:outline-none"
                required
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Description</span>
            <input
              type="text"
              placeholder="Multi-agent blog content pipeline"
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Default Workflow ID</span>
              <input
                type="text"
                placeholder="blog-agent-v1"
                value={form.defaultWorkflowId}
                onChange={(e) => setField("defaultWorkflowId", e.target.value)}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:border-teal-400 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Language</span>
              <select
                value={form.language}
                onChange={(e) => setField("language", e.target.value as IntegrationLanguage | "")}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
              >
                <option value="">Select…</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Repository URL (optional)</span>
            <input
              type="url"
              placeholder="https://github.com/yourorg/blog-agent"
              value={form.repositoryUrl}
              onChange={(e) => setField("repositoryUrl", e.target.value)}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? "Creating…" : "Add integration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const { onUnauthorized } = useDashboardAuth();
  const router = useRouter();
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    void loadIntegrations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadIntegrations() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations?limit=100", {
        headers: mergeAuthHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized("Access key expired or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? "Failed to load integrations.");
        return;
      }
      const data = await res.json() as { integrations: ProjectIntegration[] };
      setIntegrations(data.integrations ?? []);
    } catch {
      setError("Could not connect to AgentPulse. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  function handleCreated(integration: ProjectIntegration) {
    setShowAddForm(false);
    router.push(`/dashboard/integrations/${integration.integrationId}`);
  }

  return (
    <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
      {showAddForm && (
        <AddIntegrationForm
          onClose={() => setShowAddForm(false)}
          onCreated={handleCreated}
        />
      )}

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Project Integrations</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Connect agentic AI projects so AgentPulse can receive runtime proof runs.
            Each integration provides setup instructions and tracks connection status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            ← Overview
          </Link>
          <button
            onClick={() => setShowAddForm(true)}
            type="button"
            className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
          >
            Add integration
          </button>
        </div>
      </section>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading integrations…</Card>
      ) : error ? (
        <Card className="p-8">
          <p className="text-sm font-medium text-amber-700">{error}</p>
          <button
            className="mt-3 rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-teal-800"
            onClick={() => void loadIntegrations()}
            type="button"
          >
            Retry
          </button>
        </Card>
      ) : integrations.length === 0 ? (
        <Card className="p-8">
          <p className="text-sm font-medium text-slate-700">No integrations yet.</p>
          <p className="mt-2 text-sm text-slate-500">
            Connect your first project. Static repository scans require no setup — live proof
            runs require a small trace adapter added to your AI project.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => setShowAddForm(true)}
              type="button"
              className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
            >
              Add integration
            </button>
            <Link
              href="/dashboard/scanner"
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Open Repository Scanner
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {integrations.map((integration) => {
            const displayStatus = computeDisplayStatus(integration);
            return (
              <Link
                key={integration.integrationId}
                href={`/dashboard/integrations/${integration.integrationId}`}
                className="group rounded-lg border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-950">{integration.projectName}</p>
                      <span className="font-mono text-xs text-slate-400">{integration.projectId}</span>
                      {integration.defaultWorkflowId && (
                        <Badge tone="neutral">{integration.defaultWorkflowId}</Badge>
                      )}
                    </div>
                    {integration.description && (
                      <p className="mt-1 truncate text-xs text-slate-500">{integration.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Badge tone={statusTone(displayStatus)}>{displayStatus.replace(/_/g, " ")}</Badge>
                    <Badge tone={modeTone(integration.mode)}>{integration.mode.replace(/_/g, " ")}</Badge>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-4 lg:grid-cols-5">
                  <div>
                    <dt className="font-medium text-slate-400">Language</dt>
                    <dd>{languageLabel(integration.language)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Runs</dt>
                    <dd>{integration.runCount}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Last event</dt>
                    <dd>{formatDateTime(integration.lastEventAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Last run status</dt>
                    <dd>{integration.lastRunStatus ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Created</dt>
                    <dd>{formatDateTime(integration.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
