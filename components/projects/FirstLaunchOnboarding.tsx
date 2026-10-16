"use client";

import { useState } from "react";
import { ConnectAgentWizard } from "./ConnectAgentWizard";

interface FirstLaunchOnboardingProps {
  onDemoLoaded?: () => void;
  onProjectCreated?: () => void;
}

export function FirstLaunchOnboarding({ onDemoLoaded, onProjectCreated }: FirstLaunchOnboardingProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLoadDemo() {
    setLoadingDemo(true);
    setError(null);
    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });

      if (!res.ok) {
        throw new Error("Failed to initialize demo project.");
      }

      const data = (await res.json()) as { failureRunId?: string };
      if (onDemoLoaded) {
        onDemoLoaded();
      } else if (data.failureRunId) {
        window.location.href = `/dashboard/runs/${data.failureRunId}`;
      } else {
        window.location.href = "/dashboard/projects";
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingDemo(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl py-8">
      {/* Hero Welcome */}
      <div className="rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-8 sm:p-12 text-center shadow-sm">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800 mb-6">
          <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
          Local-First Developer Experience
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-950">
          Welcome to Reeprov
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 leading-relaxed">
          Local-first debugging and reproducibility infrastructure for AI agents.
          Capture execution evidence, reproduce failures, fork from checkpoints, compare behavior, evaluate candidate fixes, and turn failures into regression tests.
        </p>

        {error && (
          <div className="mx-auto mt-4 max-w-md rounded-lg bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="w-full sm:w-auto rounded-xl bg-teal-700 px-6 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 transition transform active:scale-95"
          >
            Connect Your First Agent →
          </button>

          <button
            type="button"
            onClick={handleLoadDemo}
            disabled={loadingDemo}
            className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition"
          >
            {loadingDemo ? "Setting up Demo..." : "Explore Demo Run"}
          </button>
        </div>
      </div>

      {/* 3 Pillars Overview */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700 text-lg mb-4">
            🔒
          </div>
          <h2 className="text-sm font-bold text-slate-950">Loopback Privacy Guarantee</h2>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Bound strictly to <code>127.0.0.1</code>. No cloud telemetry, no account registration, and zero remote data storage.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 text-lg mb-4">
            🔍
          </div>
          <h2 className="text-sm font-bold text-slate-950">Deep Trace Diagnostic</h2>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Capture every model token, external tool call, retrieval snippet, and state mutation with cryptographic provenance.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700 text-lg mb-4">
            🛡️
          </div>
          <h2 className="text-sm font-bold text-slate-950">Regression CI Gates</h2>
          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
            Freeze golden baselines, curate test cases from real failures, and enforce automated CI gates with <code>reeprov regression check</code>.
          </p>
        </div>
      </div>

      {/* Connect Wizard Modal */}
      <ConnectAgentWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onProjectCreated={() => {
          setWizardOpen(false);
          if (onProjectCreated) onProjectCreated();
        }}
      />
    </div>
  );
}
