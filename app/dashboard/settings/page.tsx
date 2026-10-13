"use client";

import { useEffect, useState } from "react";
import type { PrivacyPosture } from "@/lib/storage/dataPath";

export default function SettingsPrivacyPage() {
  const [posture, setPosture] = useState<PrivacyPosture | null>(null);
  const [loading, setLoading] = useState(true);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadPosture() {
      try {
        const res = await fetch("/api/settings/privacy");
        if (res.ok) {
          const data = (await res.json()) as PrivacyPosture;
          setPosture(data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    void loadPosture();
  }, []);

  async function handleResetDemo() {
    setResettingDemo(true);
    setDemoMessage(null);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (res.ok) {
        setDemoMessage("Demo project has been completely reset to deterministic initial state.");
      } else {
        setDemoMessage("Failed to reset demo project.");
      }
    } catch {
      setDemoMessage("Network error resetting demo project.");
    } finally {
      setResettingDemo(false);
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-xs text-slate-400">
        Loading instance settings & privacy posture...
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Header */}
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-xl font-bold text-slate-950">Settings & Privacy Center</h1>
        <p className="mt-1 text-xs text-slate-500">
          Inspect personal local data storage location, loopback network isolation, and privacy guarantees.
        </p>
      </div>

      {/* Privacy Guarantees */}
      <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-6 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
            ✓
          </span>
          <h2 className="text-sm font-bold text-teal-950">Zero-Telemetry Privacy Guarantee</h2>
        </div>
        <p className="mt-2 text-xs text-teal-900 leading-relaxed">
          AgentPulse is self-hostable, local-first software. All execution traces, model prompts, and checkpoints remain exclusively on your local machine or private server.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-teal-200 bg-white p-3 text-xs">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Cloud Telemetry</span>
            <span className="font-bold text-slate-900">{posture?.telemetryStatus ?? "DISABLED"}</span>
          </div>
          <div className="rounded-xl border border-teal-200 bg-white p-3 text-xs">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">Central Cloud Sync</span>
            <span className="font-bold text-slate-900">{posture?.cloudSync ?? "DISABLED"}</span>
          </div>
          <div className="rounded-xl border border-teal-200 bg-white p-3 text-xs">
            <span className="text-slate-400 font-semibold block text-[10px] uppercase">External Accounts</span>
            <span className="font-bold text-slate-900">{posture?.accountsConfigured ?? "NONE"}</span>
          </div>
        </div>
      </div>

      {/* Storage & Network Posture */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-950">Data Root & Network Configuration</h2>

        <div className="space-y-3 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block">Operating Mode</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-800">
                {posture?.mode ?? "personal_local"}
              </span>
              <span className="text-slate-500 text-[11px]">
                ({posture?.mode === "personal_local" ? "Default single personal operator" : "Private deployment"})
              </span>
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block">Personal Data Root Directory (AGENTPULSE_HOME)</label>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-800">
                {posture?.dataPath ?? "~/.agentpulse"}
              </code>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Inspect in your terminal anytime with: <code className="font-mono">pulse data-path</code>
            </p>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block">Network Binding</label>
            <div className="mt-1 font-mono text-slate-800">
              {posture?.networkBoundHost ?? "127.0.0.1 (Loopback only)"}
            </div>
          </div>
        </div>
      </div>

      {/* Demo Management */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-3">
        <h2 className="text-sm font-bold text-slate-950">Demo Project Controls</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          The &quot;Demo Support Agent&quot; project contains isolated reference data. You can re-initialize it to its pristine initial state anytime without affecting real projects.
        </p>

        {demoMessage && (
          <div className="rounded-lg bg-teal-50 border border-teal-200 p-2.5 text-xs text-teal-800">
            {demoMessage}
          </div>
        )}

        <div className="pt-2">
          <button
            type="button"
            onClick={handleResetDemo}
            disabled={resettingDemo}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            {resettingDemo ? "Resetting Demo..." : "Reset Demo Project Data"}
          </button>
        </div>
      </div>
    </div>
  );
}
