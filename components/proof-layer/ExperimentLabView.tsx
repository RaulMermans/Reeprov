"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import type { ExperimentDefinition, ExperimentResult, ArmAggregate } from "@/lib/core/contracts/experiment";
import type { EvalSuite } from "@/lib/core/contracts/evalDefinitions";

export function ExperimentLabView() {
  const [experiments, setExperiments] = useState<ExperimentDefinition[]>([]);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [selectedExp, setSelectedExp] = useState<ExperimentDefinition | null>(null);
  const [selectedResult, setSelectedResult] = useState<ExperimentResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  // New Experiment Form State
  const [formBaseline, setFormBaseline] = useState("");
  const [formName, setFormName] = useState("");
  const [formHypothesis, setFormHypothesis] = useState("");
  const [formSuite, setFormSuite] = useState("");
  const [formRepetitions, setFormRepetitions] = useState(1);
  const [formVarType, setFormVarType] = useState<"prompt" | "context_exclusion" | "memory_exclusion">("prompt");
  const [formVarTarget, setFormVarTarget] = useState("system_prompt");
  const [formVarValues, setFormVarValues] = useState('["Prompt v8 (structured)", "Prompt v9 (concise)"]');
  const [formMaxCost, setFormMaxCost] = useState(5.0);
  const [activeTab, setActiveTab] = useState<"results" | "new">("results");
  const [matrixPreview, setMatrixPreview] = useState<{ total_arms: number; total_trials: number; single_variable: boolean } | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [expRes, suitesRes] = await Promise.all([
          fetch("/api/experiments").then((r) => (r.ok ? r.json() : { experiments: [], results: [] })),
          fetch("/api/evals/suites").then((r) => (r.ok ? r.json() : { suites: [] })),
        ]);

        setExperiments(expRes.experiments ?? []);
        setSuites(suitesRes.suites ?? []);
        if (expRes.results?.length > 0) {
          setSelectedResult(expRes.results[0]);
        }
      } catch (err) {
        console.error("Failed to load experiment lab data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  async function handlePreviewMatrix() {
    try {
      const values = JSON.parse(formVarValues);
      const def: Partial<ExperimentDefinition> = {
        experiment_id: `exp_${Date.now()}`,
        name: formName || "New Experiment",
        baseline_run_id: formBaseline || "run_baseline",
        eval_suite_id: formSuite || suites[0]?.suite_id || "support-release",
        repetitions: formRepetitions,
        budget: {
          max_cost_usd: formMaxCost,
          max_trials: 20,
          max_model_calls: 100,
          max_duration_ms: 300_000,
          max_concurrency: 2,
          allow_live_model_calls: false,
          timeout_ms: 30_000,
        },
        variables: [
          {
            variable_id: `var_${formVarType}`,
            name: formVarTarget,
            type: formVarType,
            target_identifier: formVarTarget,
            values,
            supported: true,
          },
        ],
        arms: [],
      };

      const res = await fetch("/api/experiments/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(def),
      });

      if (res.ok) {
        const data = await res.json();
        setMatrixPreview(data.plan);
      }
    } catch (err) {
      console.error("Failed to preview matrix:", err);
    }
  }

  async function handleExecuteExperiment() {
    try {
      setExecuting(true);
      const values = JSON.parse(formVarValues);
      const def: Partial<ExperimentDefinition> = {
        experiment_id: `exp_${Date.now()}`,
        name: formName || "Controlled Agent Experiment",
        hypothesis: formHypothesis,
        baseline_run_id: formBaseline,
        eval_suite_id: formSuite || suites[0]?.suite_id || "support-release",
        repetitions: formRepetitions,
        budget: {
          max_cost_usd: formMaxCost,
          max_trials: 20,
          max_model_calls: 100,
          max_duration_ms: 300_000,
          max_concurrency: 2,
          allow_live_model_calls: false,
          timeout_ms: 30_000,
        },
        variables: [
          {
            variable_id: `var_${formVarType}`,
            name: formVarTarget,
            type: formVarType,
            target_identifier: formVarTarget,
            values,
            supported: true,
          },
        ],
        arms: [],
      };

      const res = await fetch("/api/experiments/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(def),
      });

      if (res.ok) {
        const data = await res.json();
        setSelectedResult(data.result);
        setActiveTab("results");
      }
    } catch (err) {
      console.error("Failed to run experiment:", err);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Experiment Lab</h1>
          <p className="text-sm text-slate-500">
            Controlled candidate variants, repeatability evaluation, and policy-driven winner selection.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab(activeTab === "results" ? "new" : "results")}
            className="rounded-md bg-teal-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-teal-500"
          >
            {activeTab === "results" ? "+ New Experiment" : "View Results"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading Experiment Lab...</div>
      ) : (
        <div>
          {/* TAB 1: NEW EXPERIMENT BUILDER */}
          {activeTab === "new" && (
            <div className="max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-5">
              <h2 className="text-base font-bold text-slate-900">Configure Controlled Experiment</h2>

              <div className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700">Experiment Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Prompt Optimization v8 vs v9"
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">Hypothesis (Structured Rationale)</label>
                  <textarea
                    value={formHypothesis}
                    onChange={(e) => setFormHypothesis(e.target.value)}
                    placeholder="e.g. Adding concise customer context should reduce tokens without decreasing task success."
                    rows={2}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700">Baseline Run ID / Path</label>
                    <input
                      type="text"
                      value={formBaseline}
                      onChange={(e) => setFormBaseline(e.target.value)}
                      placeholder="e.g. run_support_01 or tests/fixtures/canonical/fixture-j-context-ablation-baseline.json"
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">EvalSuite</label>
                    <select
                      value={formSuite}
                      onChange={(e) => setFormSuite(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                    >
                      {suites.map((s) => (
                        <option key={s.suite_id} value={s.suite_id}>
                          {s.name} ({s.suite_id}@v{s.version})
                        </option>
                      ))}
                      <option value="support-release">support-release@1</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700">Variable Type</label>
                    <select
                      value={formVarType}
                      onChange={(e) => setFormVarType(e.target.value as any)}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                    >
                      <option value="prompt">Prompt Variation</option>
                      <option value="context_exclusion">Context Item Exclusion</option>
                      <option value="memory_exclusion">Memory Exclusion</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">Target Identifier</label>
                    <input
                      type="text"
                      value={formVarTarget}
                      onChange={(e) => setFormVarTarget(e.target.value)}
                      placeholder="e.g. system_prompt or ctx_item_1"
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700">Repetitions (n)</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={formRepetitions}
                      onChange={(e) => setFormRepetitions(parseInt(e.target.value, 10))}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700">Candidate Values (JSON Array)</label>
                  <textarea
                    value={formVarValues}
                    onChange={(e) => setFormVarValues(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono"
                  />
                </div>

                <div className="flex gap-4 items-center pt-2">
                  <button
                    type="button"
                    onClick={handlePreviewMatrix}
                    className="px-3 py-1.5 rounded border border-slate-300 bg-slate-50 text-slate-700 font-medium hover:bg-slate-100"
                  >
                    Preview Matrix
                  </button>

                  <button
                    type="button"
                    disabled={executing}
                    onClick={handleExecuteExperiment}
                    className="px-4 py-1.5 rounded bg-teal-600 text-white font-semibold hover:bg-teal-500 disabled:opacity-50"
                  >
                    {executing ? "Executing Fork Trials..." : "Execute Experiment"}
                  </button>
                </div>

                {matrixPreview && (
                  <div className="p-3 rounded bg-teal-50 border border-teal-200 text-teal-900 mt-3">
                    <div className="font-semibold">Pre-Flight Matrix Validation:</div>
                    <div>Arms to generate: {matrixPreview.total_arms} (1 Baseline + {matrixPreview.total_arms - 1} Candidates)</div>
                    <div>Total Trials: {matrixPreview.total_trials}</div>
                    <div>Single Variable Isolation: {matrixPreview.single_variable ? "✅ Verified" : "⚠️ Multi-variable"}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: RESULTS VIEW */}
          {activeTab === "results" && (
            <div className="space-y-6">
              {selectedResult ? (
                <>
                  {/* Recommended Winner Card */}
                  <div className="rounded-lg border-2 border-teal-500 bg-teal-50/40 p-5 shadow-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">🏆</span>
                        <h2 className="text-base font-bold text-teal-950">
                          Recommended Candidate: {selectedResult.recommended_candidate ?? "None"}
                        </h2>
                      </div>
                      <span className="rounded bg-teal-200 px-2.5 py-0.5 text-xs font-bold text-teal-900 uppercase">
                        CANDIDATE_RECOMMENDED
                      </span>
                    </div>

                    <p className="text-xs text-teal-900/90 leading-relaxed font-medium">
                      {selectedResult.recommendation_basis}
                    </p>

                    <div className="pt-2 border-t border-teal-200/60 flex flex-wrap items-center justify-between text-[11px] text-teal-800">
                      <span>Budget Consumed: ${selectedResult.budget_consumed.cost_usd.toFixed(4)} ({selectedResult.budget_consumed.trials_executed} trials in {selectedResult.budget_consumed.duration_ms}ms)</span>
                      <span className="font-semibold text-slate-600">
                        🔒 Promotion requires external approval. Automatic promotion denied.
                      </span>
                    </div>
                  </div>

                  {/* Arms Comparison Table */}
                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="p-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center text-xs font-semibold text-slate-700 uppercase">
                      <span>Candidate Arms & Performance Summary</span>
                      <span className="text-slate-400 font-mono text-[10px]">
                        Experiment ID: {selectedResult.experiment_id}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-600">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider">
                          <tr>
                            <th className="px-4 py-3">Arm</th>
                            <th className="px-4 py-3">Success Rate</th>
                            <th className="px-4 py-3">Mean Score</th>
                            <th className="px-4 py-3">Mean Cost</th>
                            <th className="px-4 py-3">Latency</th>
                            <th className="px-4 py-3">Safety / Approval</th>
                            <th className="px-4 py-3">Repeatability</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                          {selectedResult.aggregates.map((agg) => {
                            const isWinner = agg.arm_id === selectedResult.recommended_candidate;
                            return (
                              <tr
                                key={agg.arm_id}
                                className={isWinner ? "bg-teal-50/40 font-semibold text-slate-900" : "hover:bg-slate-50"}
                              >
                                <td className="px-4 py-3">
                                  <div className="font-sans font-medium text-slate-900 flex items-center gap-1.5">
                                    {isWinner && <span className="text-teal-600">★</span>}
                                    {agg.arm_name}
                                    {agg.is_baseline && (
                                      <span className="text-[10px] rounded bg-slate-200 text-slate-700 px-1 py-0.2">
                                        Baseline
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono">{agg.arm_id}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                      agg.pass_rate >= 0.8 ? "text-emerald-700 bg-emerald-50" : "text-amber-700 bg-amber-50"
                                    }`}
                                  >
                                    {(agg.pass_rate * 100).toFixed(0)}%
                                  </span>
                                </td>
                                <td className="px-4 py-3">{agg.mean_score.toFixed(3)}</td>
                                <td className="px-4 py-3">${agg.mean_total_cost.toFixed(4)}</td>
                                <td className="px-4 py-3">{(agg.mean_latency_ms / 1000).toFixed(2)}s</td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      agg.safety_pass && agg.approval_pass
                                        ? "text-emerald-700 bg-emerald-50"
                                        : "text-red-700 bg-red-50"
                                    }`}
                                  >
                                    {agg.safety_pass && agg.approval_pass ? "PASS" : "FAIL"}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-sans text-[10px] text-slate-500">
                                  {agg.repeatability_note || `n = ${agg.n}`}
                                </td>
                                <td className="px-4 py-3 text-right font-sans">
                                  {!agg.is_baseline && (
                                    <Link
                                      href={`/dashboard/runs/compare?baseline=${selectedResult.baseline_arm_id}&candidate=${agg.arm_id}`}
                                      className="text-teal-600 hover:text-teal-800 underline text-xs"
                                    >
                                      Compare Diff →
                                    </Link>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Trials Log */}
                  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                    <h3 className="text-xs font-bold text-slate-700 uppercase">
                      Executed Trials ({selectedResult.trial_summaries.length})
                    </h3>
                    <div className="divide-y divide-slate-100 text-xs">
                      {selectedResult.trial_summaries.map((t) => (
                        <div key={t.trial_id} className="py-2 flex justify-between items-center text-slate-600">
                          <div>
                            <span className="font-mono text-slate-900 font-medium">{t.trial_id}</span>
                            <span className="ml-2 text-slate-400">Arm: {t.arm_id} (rep {t.repetition_index + 1})</span>
                          </div>
                          <div className="flex gap-4 font-mono text-[11px]">
                            <span>Candidate: ${t.candidate_cost_usd.toFixed(4)}</span>
                            <span>Grader: ${t.grader_cost_usd.toFixed(4)}</span>
                            <span>{t.duration_ms}ms</span>
                            <span className={t.status === "COMPLETED" ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                              {t.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-16 text-center text-sm text-slate-400 bg-white rounded-lg border border-slate-200">
                  <p>No experiment result selected.</p>
                  <p className="mt-1 text-xs">Configure and execute an experiment or select a prior run.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
