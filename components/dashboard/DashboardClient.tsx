"use client";

import { useEffect, useState } from "react";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { FindingTable } from "@/components/dashboard/FindingTable";
import { HealthOverview } from "@/components/dashboard/HealthOverview";
import { MappingGaps } from "@/components/dashboard/MappingGaps";
import { ModelMatrix } from "@/components/dashboard/ModelMatrix";
import { RepoSelector } from "@/components/dashboard/RepoSelector";
import { ScanSummary } from "@/components/dashboard/ScanSummary";
import { StaticProofReconstructionPanel } from "@/components/dashboard/StaticProofReconstructionPanel";
import { SystemGraphView } from "@/components/dashboard/SystemGraphView";
import { WorkflowCard } from "@/components/dashboard/WorkflowCard";
import { Card } from "@/components/ui/Card";
import { mergeAuthHeaders } from "@/lib/auth/internalKey";
import { useDashboardAuth } from "@/lib/auth/dashboardAuthContext";
import { exportReportMarkdown } from "@/lib/reports/exportMarkdown";
import { DIRECT_ZIP_UPLOAD_MAX_BYTES, DIRECT_ZIP_UPLOAD_MAX_MB } from "@/lib/zip/limits";
import type { FormEvent } from "react";
import type { ScanReport } from "@/lib/scanner/types";

const ZIP_TOO_LARGE_CLIENT_MESSAGE = `This ZIP is too large for direct Vercel upload. Direct ZIP upload supports files up to ${DIRECT_ZIP_UPLOAD_MAX_MB} MB. Use GitHub repository scanning for larger repos.`;
const ZIP_TOO_LARGE_RECOMMENDATION = "For larger codebases, paste the GitHub repo URL or select the repository from the GitHub tab. GitHub scanning avoids the direct upload body limit.";

interface RepositorySummary {
  owner: string;
  name: string;
  fullName: string;
  private?: boolean;
  defaultBranch?: string;
}

export function DashboardClient({ initialReport }: { initialReport: ScanReport }) {
  const { onUnauthorized } = useDashboardAuth();
  const [report, setReport] = useState<ScanReport>(initialReport);
  const [scanMode, setScanMode] = useState<"github" | "zip">("github");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [failedScanReportLabel, setFailedScanReportLabel] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    void loadRepositories();
  }, [mounted]);

  function expireAccessKey(message: string) {
    onUnauthorized(message);
  }

  async function loadRepositories() {
    setLoadingRepos(true);
    setErrorMessage(null);

    try {
      const body = await fetchApi<{
        mode: "mock" | "github";
        repos: RepositorySummary[];
      }>("/api/repos", {
        headers: mergeAuthHeaders(),
      });

      setRepositories(body.repos);
      setFailedScanReportLabel(null);
      setSuccessMessage(
        body.mode === "mock"
          ? "Using mock repositories because GITHUB_TOKEN is not configured."
          : `Loaded ${body.repos.length} repositories.`,
      );
    } catch (error) {
      setSuccessMessage(null);
      setFailedScanReportLabel(null);

      if (isUnauthorized(error)) {
        expireAccessKey("Access key expired or invalid. Please unlock again.");
        return;
      }

      setErrorMessage(apiMessage(error, "Repository loading failed."));
    } finally {
      setLoadingRepos(false);
    }
  }

  async function scan(repo: { owner?: string; name?: string; mock?: boolean }) {
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFailedScanReportLabel(null);

    try {
      const body = await fetchApi<ScanReport>("/api/scan", {
        method: "POST",
        headers: mergeAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(repo),
      });

      setReport(body);
      setSuccessMessage(`Scan complete for ${body.scanSource?.label ?? body.repoName}.`);
    } catch (error) {
      if (isUnauthorized(error)) {
        expireAccessKey("Access key expired or invalid. Please unlock again.");
        return;
      }

      const target = repo.mock ? "Mock scan" : [repo.owner, repo.name].filter(Boolean).join("/");
      setErrorMessage(`Scan failed${target ? ` for ${target}` : ""}: ${apiMessage(error, "Scan failed.")}`);
      setFailedScanReportLabel(report.scanSource?.label ?? report.repoName);
    } finally {
      setLoading(false);
    }
  }

  async function scanZip() {
    if (!zipFile) {
      setErrorMessage("Choose a ZIP file to scan.");
      setFailedScanReportLabel(null);
      return;
    }

    if (!zipFile.name.toLowerCase().endsWith(".zip")) {
      setErrorMessage("Choose a file with a .zip filename.");
      setFailedScanReportLabel(null);
      return;
    }

    if (zipFile.size > DIRECT_ZIP_UPLOAD_MAX_BYTES) {
      setErrorMessage(ZIP_TOO_LARGE_CLIENT_MESSAGE);
      setFailedScanReportLabel(null);
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFailedScanReportLabel(null);

    try {
      const formData = new FormData();
      formData.set("zip", zipFile);

      const body = await fetchApi<ScanReport>("/api/scan-zip", {
        method: "POST",
        headers: mergeAuthHeaders(),
        body: formData,
      });

      setReport(body);
      setSuccessMessage(`ZIP scan complete for ${body.scanSource?.label ?? body.repoName}.`);
    } catch (error) {
      if (isUnauthorized(error)) {
        expireAccessKey("Access key expired or invalid. Please unlock again.");
        return;
      }

      setErrorMessage(`ZIP scan failed for ${zipFile.name}: ${apiMessage(error, "ZIP scan failed.")}`);
      setFailedScanReportLabel(report.scanSource?.label ?? report.repoName);
    } finally {
      setLoading(false);
    }
  }

  function clearZip() {
    setZipFile(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setFailedScanReportLabel(null);
  }

  function handleZipFileChange(file: File | null) {
    setZipFile(file);
    setSuccessMessage(null);

    if (file && file.size > DIRECT_ZIP_UPLOAD_MAX_BYTES) {
      setErrorMessage(ZIP_TOO_LARGE_CLIENT_MESSAGE);
      setFailedScanReportLabel(null);
      return;
    }

    setErrorMessage(null);
    setFailedScanReportLabel(null);
  }

  function downloadJson() {
    downloadText(`${safeFilename(report.scanSource?.label ?? report.repoName)}-agentpulse-report.json`, JSON.stringify(report, null, 2), "application/json");
  }

  function downloadMarkdown() {
    downloadText(`${safeFilename(report.scanSource?.label ?? report.repoName)}-agentpulse-report.md`, exportReportMarkdown(report), "text/markdown");
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(exportReportMarkdown(report));
      setSuccessMessage("Markdown report copied to clipboard.");
      setErrorMessage(null);
    } catch {
      setErrorMessage("Could not copy Markdown report to clipboard.");
      setFailedScanReportLabel(null);
    }
  }

  if (!mounted) {
    return (
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <ScannerPageHeader />
        <Card className="p-6 text-sm text-slate-500">Loading scanner...</Card>
      </main>
    );
  }

  const zipTooLarge = Boolean(zipFile && zipFile.size > DIRECT_ZIP_UPLOAD_MAX_BYTES);
  const showLastSuccessfulScanLabel = Boolean(errorMessage && failedScanReportLabel);

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <ScannerPageHeader />

      <Card className="p-4">
        <div className="mb-4 inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
          {(["github", "zip"] as const).map((mode) => (
            <button
              className={`min-h-9 rounded px-3 text-sm font-medium ${
                scanMode === mode
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:text-slate-950"
              }`}
              key={mode}
              onClick={() => setScanMode(mode)}
              type="button"
            >
              {mode === "github" ? "GitHub repository" : "ZIP upload"}
            </button>
          ))}
        </div>
        {scanMode === "github" ? (
          <RepoSelector
            loading={loading}
            loadingRepos={loadingRepos}
            onScan={scan}
            repositories={repositories}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              Upload a GitHub-downloaded ZIP for small repos. Direct ZIP upload is limited to {DIRECT_ZIP_UPLOAD_MAX_MB} MB on Vercel. For larger repositories, use GitHub repository scanning.
            </p>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600" htmlFor="zip-upload">
                ZIP file
                <input
                  accept=".zip,application/zip"
                  className="min-h-10 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:font-medium focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
                  disabled={loading}
                  id="zip-upload"
                  onChange={(event) => handleZipFileChange(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              {zipFile ? (
                <div className={`rounded-md border px-3 py-2 text-sm ${
                  zipTooLarge
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}>
                  <div className="max-w-80 truncate font-medium text-slate-950">
                    Selected file: {zipFile.name} - {formatBytes(zipFile.size)}
                  </div>
                  {zipTooLarge ? (
                    <div className="mt-1 font-medium">Too large for direct upload - use GitHub scan.</div>
                  ) : null}
                </div>
              ) : null}
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={loading || !zipFile || zipTooLarge}
                onClick={scanZip}
                type="button"
              >
                {loading ? "Scanning" : "Scan ZIP"}
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={loading || !zipFile}
                onClick={clearZip}
                type="button"
              >
                Clear
              </button>
            </div>
            {zipTooLarge ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                {ZIP_TOO_LARGE_RECOMMENDATION}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {errorMessage ? (
        <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800 shadow-none">
          {errorMessage}
        </Card>
      ) : null}

      {successMessage ? (
        <Card className="border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 shadow-none">
          {successMessage}
        </Card>
      ) : null}

      {loading ? (
        <Card className="p-6 text-sm text-slate-600">Loading scan report...</Card>
      ) : (
        <>
          {showLastSuccessfulScanLabel ? (
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Last successful scan
              </div>
              <div className="mt-1 break-all text-lg font-semibold text-slate-950">
                {failedScanReportLabel}
              </div>
            </div>
          ) : null}
          <HealthOverview report={report} />
          <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Export report</h2>
              <p className="mt-0.5 text-xs text-slate-500">Download or copy the current redacted scan report.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white" onClick={downloadJson} type="button">
                Download JSON
              </button>
              <button className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white" onClick={downloadMarkdown} type="button">
                Download Markdown
              </button>
              <button className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700" onClick={copyMarkdown} type="button">
                Copy Markdown
              </button>
            </div>
          </Card>
          <ScanSummary report={report} />

          {report.systemGraph ? (
            <ScannerSection title="AI System Graph">
              <SystemGraphView graph={report.systemGraph} />
            </ScannerSection>
          ) : null}

          <ScannerSection title="Model / Provider Matrix">
            <ModelMatrix
              agents={report.detectedAgents}
              models={report.detectedModels}
              performance={report.modelPerformance}
            />
          </ScannerSection>

          {report.systemGraph ? (
            <ScannerSection title="Mapping Gaps">
              <MappingGaps graph={report.systemGraph} />
            </ScannerSection>
          ) : null}

          <ScannerSection title="Static Proof Reconstruction">
            <StaticProofReconstructionPanel report={report} />
          </ScannerSection>

          <ScannerSection title="Detected Agents">
            <div className="grid gap-4 lg:grid-cols-2">
              {report.detectedAgents.length > 0 ? (
                report.detectedAgents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
              ) : (
                <Card className="p-5 text-sm text-slate-500">
                  {noAgentsMessage(report.projectType)}
                </Card>
              )}
            </div>
          </ScannerSection>

          <ScannerSection title="AI / Product Workflows">
            {report.detectedWorkflowsDetailed.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {report.detectedWorkflowsDetailed.map((workflow) => (
                  <WorkflowCard key={workflow.id} workflow={workflow} />
                ))}
              </div>
            ) : (
              <Card className="p-5 text-sm text-slate-500">
                {report.projectType === "agent_system"
                  ? "No AI/product workflow manifest detected."
                  : report.detectedCIWorkflows.length > 0
                    ? "No AI/product workflow manifest detected. CI workflows are shown separately."
                    : "No AI/product workflow manifest detected."}
              </Card>
            )}
          </ScannerSection>

          {report.detectedCIWorkflows.length > 0 ? (
            <ScannerSection title="CI Workflows">
              <Card className="p-4">
                <ul className="space-y-2">
                  {report.detectedCIWorkflows.map((w) => (
                    <li className="flex items-center justify-between gap-3" key={w.path}>
                      <span className="break-all font-mono text-xs text-slate-600">{w.path}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                        {ciProviderLabel(w.provider)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </ScannerSection>
          ) : null}

          <ScannerSection title="Detected Prompts">
            <Card className="p-5">
              {report.detectedPrompts.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {report.detectedPrompts.map((prompt) => (
                    <li className="break-all font-mono text-xs" key={prompt}>{prompt}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-slate-500">
                  No versioned prompt files detected.{" "}
                  {report.projectType === "ai_application"
                    ? "Prompt-related source files may exist but are not counted as prompt assets."
                    : "Add prompts/ directory or reference prompt_path in agents.yaml."}
                </div>
              )}
            </Card>
          </ScannerSection>

          <ScannerSection title="Findings">
            <FindingTable findings={report.findings} />
          </ScannerSection>

          <ScannerSection title="Recommended Next Actions">
            <Card className="p-5">
              {report.recommendations.length > 0 ? (
                <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                  {report.recommendations.map((recommendation) => (
                    <li key={recommendation}>{recommendation}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No recommended actions at this time.</p>
              )}
            </Card>
          </ScannerSection>

          <footer className="border-t border-slate-100 pt-4 text-center text-xs text-slate-400">
            AgentPulse {appVersion()} · Static scanner · Redacted report
          </footer>
        </>
      )}
    </main>
  );
}


class ApiResponseError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiResponseError";
  }
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiResponseError && error.status === 401;
}

async function fetchApi<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await readJson(response);

  if (!response.ok) {
    throw new ApiResponseError(apiMessageFromBody(body, "Request failed."), response.status);
  }

  return body as T;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function apiMessageFromBody(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return fallback;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFilename(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "scan";
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ciProviderLabel(provider: string) {
  switch (provider) {
    case "github_actions": return "GitHub Actions";
    case "gitlab": return "GitLab CI";
    case "circleci": return "CircleCI";
    default: return "CI";
  }
}

function ScannerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function ScannerPageHeader() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Repository Scanner</h1>
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Internal access required</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Scan GitHub repositories or ZIP uploads. Static analysis only — no workflow execution, no code run, no secrets stored.
      </p>
    </div>
  );
}

function noAgentsMessage(projectType: ScanReport["projectType"]): string {
  switch (projectType) {
    case "workflow_system":
      return "No explicit agents detected. This appears to be a workflow project.";
    case "ai_application":
      return "No explicit agents detected. AI-related application code was found.";
    default:
      return "No agents detected.";
  }
}

function appVersion(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_AGENTPULSE_VERSION) {
    return process.env.NEXT_PUBLIC_AGENTPULSE_VERSION;
  }
  return "local";
}
