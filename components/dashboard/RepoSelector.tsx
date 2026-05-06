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

  function submit() {
    const [owner, name] = repo.split("/");
    if (owner && name) {
      onScan({ owner, name });
      return;
    }
    onScan({ mock: true });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 md:flex-row">
      <label className="sr-only" htmlFor="repo">
        Repository
      </label>
      <input
        className="min-h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
        disabled={loading}
        list="agentpulse-repositories"
        id="repo"
        onChange={(event) => setRepo(event.target.value)}
        placeholder={loadingRepos ? "Loading repositories..." : "owner/repo"}
        value={repo}
      />
      <datalist id="agentpulse-repositories">
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
