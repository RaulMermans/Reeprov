"use client";

import { useEffect, useState } from "react";
import { AgentCard } from "@/components/dashboard/AgentCard";
import { FindingTable } from "@/components/dashboard/FindingTable";
import { HealthOverview } from "@/components/dashboard/HealthOverview";
import { RepoSelector } from "@/components/dashboard/RepoSelector";
import { ScanSummary } from "@/components/dashboard/ScanSummary";
import { Card } from "@/components/ui/Card";
import type { FormEvent } from "react";
import type { ScanReport } from "@/lib/scanner/types";

interface RepositorySummary {
  owner: string;
  name: string;
  fullName: string;
  private?: boolean;
  defaultBranch?: string;
}

export function DashboardClient({ initialReport }: { initialReport: ScanReport }) {
  const [report, setReport] = useState<ScanReport>(initialReport);
  const [loading, setLoading] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [accessKey, setAccessKey] = useState<string | null>(null);
  const [accessKeyInput, setAccessKeyInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAccessKey(getStoredAccessKey());
      setMounted(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!accessKey) {
      return;
    }

    async function loadRepositories() {
      setLoadingRepos(true);
      setErrorMessage(null);

      try {
        const body = await fetchApi<{
          mode: "mock" | "github";
          repos: RepositorySummary[];
        }>("/api/repos", {
          headers: {
            "x-agentpulse-key": accessKey ?? "",
          },
        });

        setRepositories(body.repos);
        setSuccessMessage(
          body.mode === "mock"
            ? "Using mock repositories because GITHUB_TOKEN is not configured."
            : `Loaded ${body.repos.length} repositories.`,
        );
      } catch (error) {
        setSuccessMessage(null);
        setErrorMessage(apiMessage(error, "Repository loading failed."));
      } finally {
        setLoadingRepos(false);
      }
    }

    void loadRepositories();
  }, [accessKey]);

  function saveAccessKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = accessKeyInput.trim();

    if (!trimmed) {
      setErrorMessage("Enter your AgentPulse access key.");
      return;
    }

    sessionStorage.setItem("agentpulse_access_key", trimmed);
    setAccessKey(trimmed);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function clearAccessKey() {
    sessionStorage.removeItem("agentpulse_access_key");
    setAccessKey(null);
    setAccessKeyInput("");
    setRepositories([]);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function scan(repo: { owner?: string; name?: string; mock?: boolean }) {
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const body = await fetchApi<ScanReport>("/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentpulse-key": accessKey ?? "",
        },
        body: JSON.stringify(repo),
      });

      setReport(body);
      setSuccessMessage(`Scan complete for ${body.repoName}.`);
    } catch (error) {
      setErrorMessage(apiMessage(error, "Scan failed."));
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-6 text-sm text-slate-600">Loading dashboard...</Card>
      </main>
    );
  }

  if (!accessKey) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-6 sm:px-6 lg:px-8">
        <Card className="p-6">
          <form className="flex flex-col gap-4" onSubmit={saveAccessKey}>
            <div>
              <p className="text-sm font-medium text-teal-700">AgentPulse</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Private dashboard access</h1>
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700" htmlFor="access-key">
              Access key
              <input
                autoComplete="off"
                className="min-h-10 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
                id="access-key"
                onChange={(event) => setAccessKeyInput(event.target.value)}
                type="password"
                value={accessKeyInput}
              />
            </label>
            {errorMessage ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {errorMessage}
              </div>
            ) : null}
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-800"
              type="submit"
            >
              Continue
            </button>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-teal-700">AgentPulse</p>
          <h1 className="text-2xl font-semibold text-slate-950">Private repository audit</h1>
        </div>
        <button className="text-sm font-medium text-slate-600 hover:text-slate-950" onClick={clearAccessKey} type="button">
          Change access key
        </button>
      </div>

      <RepoSelector
        loading={loading}
        loadingRepos={loadingRepos}
        onScan={scan}
        repositories={repositories}
      />

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
          <HealthOverview report={report} />
          <ScanSummary report={report} />

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Detected agents</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {report.detectedAgents.length > 0 ? (
                report.detectedAgents.map((agent) => <AgentCard agent={agent} key={agent.id} />)
              ) : (
                <Card className="p-5 text-sm text-slate-600">No agents detected.</Card>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Findings</h2>
            <FindingTable findings={report.findings} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-slate-950">Recommended next actions</h2>
            <Card className="p-5">
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-700">
                {report.recommendations.map((recommendation) => (
                  <li key={recommendation}>{recommendation}</li>
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}
    </main>
  );
}

function getStoredAccessKey() {
  if (typeof window === "undefined") {
    return null;
  }

  return sessionStorage.getItem("agentpulse_access_key");
}

async function fetchApi<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(apiMessageFromBody(body, "Request failed."));
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
