"use client";

import { useEffect, useState } from "react";
import type { ProjectLanguage } from "@/lib/projects/projectTypes";

interface ConnectAgentWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated?: (projectId: string) => void;
}

export function ConnectAgentWizard({ isOpen, onClose, onProjectCreated }: ConnectAgentWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Project details
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Step 2: Integration type
  const [language, setLanguage] = useState<ProjectLanguage>("typescript");
  const [framework, setFramework] = useState<string>("langgraph");

  // Step 3: Key generated
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Step 5: Verification polling
  const [waitingForRun, setWaitingForRun] = useState(false);
  const [capturedRunId, setCapturedRunId] = useState<string | null>(null);

  // Auto-generate project ID slug from name
  useEffect(() => {
    if (step === 1 && projectName) {
      const slug = projectName
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      setProjectId(slug);
    }
  }, [projectName, step]);

  // Polling for first run in step 5
  useEffect(() => {
    if (step !== 5 || !projectId) return;

    let isMounted = true;
    setWaitingForRun(true);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs?projectId=${encodeURIComponent(projectId)}&limit=1`);
        if (res.ok) {
          const data = (await res.json()) as { runs?: Array<{ run_id: string }> };
          if (data.runs && data.runs.length > 0 && isMounted) {
            setCapturedRunId(data.runs[0].run_id);
            setWaitingForRun(false);
            clearInterval(interval);
          }
        }
      } catch {
        // ignore polling network errors
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [step, projectId]);

  if (!isOpen) return null;

  async function handleCreateProject() {
    if (!projectName.trim()) {
      setError("Project name is required.");
      return;
    }

    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          id: projectId.trim() || undefined,
          description: description.trim() || undefined,
          language,
          framework,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Failed to create project.");
        return;
      }

      const data = (await res.json()) as {
        project: { id: string };
        rawIngestKey: string;
      };

      setProjectId(data.project.id);
      setRawKey(data.rawIngestKey);
      setStep(3); // advance to key presentation
    } catch {
      setError("Network error while creating project.");
    }
  }

  function getSnippet(): string {
    const key = rawKey || "ree_live_your_ingest_key_here";
    const pid = projectId || "my-agent-project";
    const endpoint = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";

    if (language === "typescript") {
      return `# Shell / .env configuration:
export REEPROV_URL="${endpoint}"
export REEPROV_PROJECT_ID="${pid}"
export REEPROV_INGEST_KEY="${key}"

// Application code (using client):
import { ReeprovClient } from "@reeprov/client";

const reeprov = new ReeprovClient({
  endpoint: process.env["REEPROV_URL"] || "${endpoint}",
  ingestKey: process.env["REEPROV_INGEST_KEY"] || "${key}",
});

// Start run
const runId = await reeprov.startRun({
  projectId: "${pid}",
  workflowId: "main-pipeline",
  summary: "Processing agent task",
});

try {
  // Record activity
  await reeprov.modelCallCompleted(runId, {
    model: "gpt-4o",
    inputTokens: 120,
    outputTokens: 60,
    inputSummary: "Classified incoming user request",
    outputSummary: "Delegated to customer support tool",
  });

  await reeprov.toolCallCompleted(runId, {
    toolName: "database_lookup",
    inputSummary: JSON.stringify({ query: "account_status" }),
    outputSummary: JSON.stringify({ active: true }),
  });

  await reeprov.completeRun(runId, { summary: "Task completed successfully" });
} catch (err: any) {
  await reeprov.failRun(runId, { error: err.message });
}`;
    }

    if (language === "python") {
      return `# Shell / .env configuration:
export REEPROV_URL="${endpoint}"
export REEPROV_PROJECT_ID="${pid}"
export REEPROV_INGEST_KEY="${key}"

# Python stdlib or requests:
import os
import requests

ENDPOINT = os.environ.get("REEPROV_URL", "${endpoint}")
INGEST_KEY = os.environ.get("REEPROV_INGEST_KEY", "${key}")
PROJECT_ID = os.environ.get("REEPROV_PROJECT_ID", "${pid}")

headers = {"x-reeprov-key": INGEST_KEY}

# 1. Start run
res = requests.post(
    f"{ENDPOINT}/api/runs/start",
    headers=headers,
    json={
        "project_id": PROJECT_ID,
        "project_name": "${projectName || pid}",
        "workflow_id": "main-pipeline",
        "summary": "Processing agent task",
    },
)
run_id = res.json()["run_id"]

# 2. Complete run
requests.post(
    f"{ENDPOINT}/api/runs/complete",
    headers=headers,
    json={"run_id": run_id, "summary": "Task completed successfully"},
)`;
    }

    // REST curl — fully executable copy-paste
    return `# 1. Export configuration
export REEPROV_URL="${endpoint}"
export REEPROV_PROJECT_ID="${pid}"
export REEPROV_INGEST_KEY="${key}"

# 2. Execute test run immediately
RUN_ID="${pid}-$(date +%s)"

curl -s -X POST "$REEPROV_URL/api/runs/start" \\
  -H "Content-Type: application/json" \\
  -H "x-reeprov-key: $REEPROV_INGEST_KEY" \\
  -d "{
    \\"run_id\\": \\"$RUN_ID\\",
    \\"project_id\\": \\"$REEPROV_PROJECT_ID\\",
    \\"project_name\\": \\"${projectName || pid}\\",
    \\"workflow_id\\": \\"custom-agent-workflow\\",
    \\"summary\\": \\"First instrumented run\\"
  }"

curl -s -X POST "$REEPROV_URL/api/runs/complete" \\
  -H "Content-Type: application/json" \\
  -H "x-reeprov-key: $REEPROV_INGEST_KEY" \\
  -d "{\\"run_id\\": \\"$RUN_ID\\", \\"summary\\": \\"Completed successfully\\"}"`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Connect an AI Agent</h2>
            <p className="text-xs text-slate-500">Step {step} of 5: {
              step === 1 ? "Project Identity" :
              step === 2 ? "Integration & Framework" :
              step === 3 ? "Scoped Ingest Key" :
              step === 4 ? "Instrumentation Snippet" :
              "Verify Connection"
            }</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {/* Step 1: Project Details */}
        {step === 1 && (
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">Project Name *</label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Customer Support Agent"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Project ID (Slug) *</label>
              <input
                type="text"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="customer-support-agent"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono text-xs focus:border-teal-600 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Used in client calls and CLI regression checks.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700">Description (Optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Brief description of what this agent does..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!projectName.trim()) {
                    setError("Project name is required.");
                    return;
                  }
                  setError(null);
                  setStep(2);
                }}
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Continue to Integration →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Choose Integration */}
        {step === 2 && (
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Integration / Language</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: "typescript", label: "TypeScript / Node", desc: "TypeScript Client" },
                  { id: "python", label: "Python", desc: "Python Client / HTTP" },
                  { id: "other", label: "REST / Custom", desc: "Direct curl / HTTP" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setLanguage(opt.id as ProjectLanguage)}
                    className={`rounded-xl border p-3 text-left transition ${
                      language === opt.id
                        ? "border-teal-600 bg-teal-50/50 ring-2 ring-teal-600/20"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900">{opt.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Framework Preset / Configuration Hint</label>
              <select
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-teal-600 focus:outline-none"
              >
                <option value="langgraph">LangGraph / LangChain Preset</option>
                <option value="pydanticai">PydanticAI Preset</option>
                <option value="crewai">CrewAI Preset</option>
                <option value="custom">Custom Agent Loop</option>
              </select>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">{error}</div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleCreateProject}
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Create Project & Ingest Key →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Display Ingest Key */}
        {step === 3 && (
          <div className="space-y-4 py-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <span>⚠️ Important Security Notice</span>
              </div>
              <p className="mt-1 text-xs text-amber-800">
                This key is <strong>strictly scoped to project &quot;{projectId}&quot; for trace ingestion only</strong>. It cannot access Reeprov Studio or view other projects.
                Save this key now — it will not be shown again.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Your Scoped Ingest Key</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={rawKey || ""}
                  className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 selection:bg-teal-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (rawKey) {
                      navigator.clipboard.writeText(rawKey);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shrink-0"
                >
                  {copiedKey ? "Copied!" : "Copy Key"}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                View Code Snippet →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Instrumentation Snippet */}
        {step === 4 && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Copy snippet into your agent:
              </span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(getSnippet());
                  setCopiedSnippet(true);
                  setTimeout(() => setCopiedSnippet(false), 2000);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copiedSnippet ? "Copied!" : "Copy Snippet"}
              </button>
            </div>

            <pre className="max-h-64 overflow-x-auto rounded-xl bg-slate-950 p-3.5 text-xs font-mono text-teal-300 leading-relaxed">
              {getSnippet()}
            </pre>

            <div className="flex justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(3)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                ← Back to Key
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Verify Connection →
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Verify Connection */}
        {step === 5 && (
          <div className="space-y-5 py-6 text-center">
            {waitingForRun ? (
              <div className="space-y-3">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-teal-200 border-t-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">Waiting for first run...</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Run your agent code with the snippet. Reeprov is listening on loopback (<code>http://127.0.0.1:3000</code>).
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xl">
                  ✓
                </div>
                <h3 className="text-base font-bold text-slate-900">First run captured!</h3>
                <p className="text-xs text-slate-500">
                  Reeprov successfully received evidence for <strong>{projectName}</strong>.
                </p>

                <div className="flex items-center justify-center gap-3 pt-3">
                  {capturedRunId && (
                    <a
                      href={`/dashboard/runs/${capturedRunId}`}
                      className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                    >
                      Inspect First Run →
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (onProjectCreated) onProjectCreated(projectId);
                      onClose();
                    }}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Go to Projects
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
