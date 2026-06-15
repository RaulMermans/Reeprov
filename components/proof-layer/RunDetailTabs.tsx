"use client";

import { useState } from "react";

export interface RunDetailTab {
  key: string;
  label: string;
  badge?: number;
  content: React.ReactNode;
}

/**
 * Tab bar for the run detail page. Defaults to the first tab (Overview),
 * deliberately keeping the raw trace as a secondary, opt-in surface rather
 * than the default reading experience.
 */
export function RunDetailTabs({ tabs }: { tabs: RunDetailTab[] }) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key);
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  return (
    <div data-testid="run-detail-tabs">
      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2" role="tablist" aria-label="Run detail views">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active?.key}
            onClick={() => setActiveKey(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab.key === active?.key
                ? "bg-teal-700 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
            data-testid={`run-tab-${tab.key}`}
          >
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 ? (
              <span className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                tab.key === active?.key ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-600"
              }`}>
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="mt-5" data-testid={`run-tab-panel-${active?.key}`}>
        {active?.content}
      </div>
    </div>
  );
}
