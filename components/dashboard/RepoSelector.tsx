"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface RepositorySummary {
  owner: string;
  name: string;
  fullName: string;
}

interface RepoSelectorProps {
  loading?: boolean;
  loadingRepos?: boolean;
  onScan: (repo: { owner?: string; name?: string; mock?: boolean }) => void | Promise<void>;
  repositories?: RepositorySummary[];
}

export function RepoSelector({
  loading = false,
  loadingRepos = false,
  onScan,
  repositories = [],
}: RepoSelectorProps) {
  const [repo, setRepo] = useState("");
  const hasRepositories = repositories.length > 0;

  function submit() {
    const [owner, name] = repo.split("/");
    if (owner && name) {
      onScan({ owner, name });
      return;
    }
    onScan({ mock: true });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row">
      {hasRepositories ? (
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600" htmlFor="repo-select">
          Accessible repositories
          <select
            className="min-h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
            disabled={loading}
            id="repo-select"
            onChange={(event) => setRepo(event.target.value)}
            value={repo}
          >
            <option value="">Select a repository</option>
            {repositories.map((repository) => (
              <option key={repository.fullName} value={repository.fullName}>
                {repository.fullName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="sr-only" htmlFor="repo">
        Repository
      </label>
      <input
        className="min-h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
        disabled={loading}
        list="reeprov-repositories"
        id="repo"
        onChange={(event) => setRepo(event.target.value)}
        placeholder={loadingRepos ? "Loading repositories..." : "owner/repo manual fallback"}
        value={repo}
      />
      <datalist id="reeprov-repositories">
        {repositories.map((repository) => (
          <option key={repository.fullName} value={repository.fullName} />
        ))}
      </datalist>
      <Button disabled={loading} onClick={submit} type="button">
        <Search className="mr-2 h-4 w-4" />
        {loading ? "Scanning" : "Scan"}
      </Button>
    </div>
  );
}
