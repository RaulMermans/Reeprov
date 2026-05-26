"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Overview", href: "/dashboard" },
  { label: "Runs", href: "/dashboard/runs" },
  { label: "Workflows", href: "/dashboard/workflows" },
  { label: "Repository Scanner", href: "/dashboard/scanner" },
  { label: "Scan History", href: "/dashboard/reports" },
] as const;

export function NavBar({ onLock }: { onLock?: () => void }) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-slate-950">AgentPulse</span>
            <span className="hidden rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700 sm:inline">v0</span>
          </Link>
          <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
            {NAV_ITEMS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                  isActive(href)
                    ? "bg-slate-100 text-slate-950"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
                aria-current={isActive(href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            Live
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
