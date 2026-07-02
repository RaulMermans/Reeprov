"use client";

import type { CanvasFilterState } from "@/lib/visualGraph/filters";

const FILTERS: Array<{ key: keyof CanvasFilterState; label: string }> = [
  { key: "models", label: "Models" },
  { key: "tools", label: "Tools" },
  { key: "skills", label: "Skills" },
  { key: "cli", label: "CLI" },
  { key: "evals", label: "Evals" },
  { key: "artifacts", label: "Artifacts" },
  { key: "issues", label: "Issues/Recoveries" },
  { key: "agents", label: "Agents" },
  { key: "internal", label: "Internal nodes" },
  { key: "failedOnly", label: "Failed/recovered path" },
  { key: "neighborhood", label: "Selected neighborhood" },
];

export function CanvasFilters({
  filters,
  onChange,
}: {
  filters: CanvasFilterState;
  onChange: (filters: CanvasFilterState) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2" data-testid="canvas-filters">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <label
            key={filter.key}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
          >
            <input
              type="checkbox"
              checked={filters[filter.key]}
              onChange={(event) => onChange({ ...filters, [filter.key]: event.target.checked })}
              data-testid={`canvas-filter-${filter.key}`}
            />
            {filter.label}
          </label>
        ))}
      </div>
    </div>
  );
}
