"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Primary product-oriented navigation
const PRIMARY_NAV_ITEMS = [
  { label: "Projects", href: "/dashboard/projects" },
  { label: "Runs", href: "/dashboard/runs" },
  { label: "Compare", href: "/dashboard/runs/compare" },
  { label: "Evaluate", href: "/dashboard/evals" },
  { label: "Regressions", href: "/dashboard/regressions" },
  { label: "Settings", href: "/dashboard/settings" },
] as const;

// Secondary Developer Tools (demoted surfaces)
const DEVELOPER_TOOLS_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Integrations", href: "/dashboard/integrations" },
  { label: "Workflows", href: "/dashboard/workflows" },
  { label: "Repository Scanner", href: "/dashboard/scanner" },
  { label: "Scan History", href: "/dashboard/reports" },
  { label: "Experiment Lab", href: "/dashboard/experiments" },
] as const;

export function NavBar({ onLock }: { onLock?: () => void }) {
  const pathname = usePathname();
  const [toolsOpen, setToolsOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  const isDevToolActive = DEVELOPER_TOOLS_ITEMS.some((item) => isActive(item.href));

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-slate-950">Reeprov</span>
            <span className="hidden rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700 sm:inline">
              Personal Studio
            </span>
          </Link>

          {/* Primary Navigation */}
          <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {PRIMARY_NAV_ITEMS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive(href)
                    ? "bg-slate-100 text-slate-950 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
                aria-current={isActive(href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}

            {/* Developer Tools / Advanced Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setToolsOpen(!toolsOpen)}
                className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isDevToolActive
                    ? "bg-slate-100 text-slate-950"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                Developer Tools
                <svg
                  className={`h-3.5 w-3.5 text-slate-400 transition-transform ${toolsOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {toolsOpen && (
                <div
                  className="absolute left-0 mt-1.5 w-52 rounded-lg border border-slate-200 bg-white py-1.5 shadow-lg z-50"
                  onMouseLeave={() => setToolsOpen(false)}
                >
                  <div className="px-3 py-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Advanced & History
                  </div>
                  {DEVELOPER_TOOLS_ITEMS.map(({ label, href }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setToolsOpen(false)}
                      className={`block px-3 py-1.5 text-xs font-medium transition-colors ${
                        isActive(href)
                          ? "bg-teal-50 text-teal-800 font-semibold"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex" title="Dashboard is unlocked">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" aria-hidden />
            Unlocked
          </div>
          {onLock && (
            <button
              onClick={onLock}
              type="button"
              className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
            >
              Lock dashboard
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
