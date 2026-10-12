"use client";

import React, { useState, useEffect } from "react";
import type { EvalDefinition, EvalSuite, EvalDataset, EvaluationRun } from "@/lib/core/contracts/evalDefinitions";

export function EvalStudioView() {
  const [activeTab, setActiveTab] = useState<"library" | "suites" | "datasets" | "runs">("library");
  const [definitions, setDefinitions] = useState<EvalDefinition[]>([]);
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [evalRuns, setEvalRuns] = useState<EvaluationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<EvaluationRun | null>(null);
  const [selectedDef, setSelectedDef] = useState<EvalDefinition | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [defsRes, suitesRes, datasetsRes, runsRes] = await Promise.all([
          fetch("/api/evals/definitions").then((r) => (r.ok ? r.json() : { definitions: [] })),
          fetch("/api/evals/suites").then((r) => (r.ok ? r.json() : { suites: [] })),
          fetch("/api/evals/datasets").then((r) => (r.ok ? r.json() : { datasets: [] })),
          fetch("/api/evals/runs").then((r) => (r.ok ? r.json() : { evaluation_runs: [] })),
        ]);

        setDefinitions(defsRes.definitions ?? []);
        setSuites(suitesRes.suites ?? []);
        setDatasets(datasetsRes.datasets ?? []);
        setEvalRuns(runsRes.evaluation_runs ?? []);
        if (runsRes.evaluation_runs?.length > 0) {
          setSelectedRun(runsRes.evaluation_runs[0]);
        }
      } catch (err) {
        console.error("Failed to load eval studio data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Eval Studio</h1>
          <p className="text-sm text-slate-500">
            Systematic evaluation library, suites, datasets, and post-hoc execution evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 border border-teal-200">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            Canonical Graders Active
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("library")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "library"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Eval Library ({definitions.length})
        </button>
        <button
          onClick={() => setActiveTab("suites")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "suites"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Suites ({suites.length})
        </button>
        <button
          onClick={() => setActiveTab("datasets")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "datasets"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Datasets ({datasets.length})
        </button>
        <button
          onClick={() => setActiveTab("runs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "runs"
              ? "border-teal-600 text-teal-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Evaluation Runs ({evalRuns.length})
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading evaluation assets...</div>
      ) : (
        <div>
          {/* TAB 1: LIBRARY */}
          {activeTab === "library" && (
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="px-4 py-3">Definition ID</th>
                        <th className="px-4 py-3">Family</th>
                        <th className="px-4 py-3">Grader Type</th>
                        <th className="px-4 py-3">Scope</th>
                        <th className="px-4 py-3">Severity</th>
                        <th className="px-4 py-3">Assertion / Config</th>
                        <th className="px-4 py-3">Version</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {definitions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                            No eval definitions registered yet.
                          </td>
                        </tr>
                      ) : (
                        definitions.map((def) => (
                          <tr
                            key={`${def.eval_definition_id}@${def.version}`}
                            className="hover:bg-slate-50/80 cursor-pointer"
                            onClick={() => setSelectedDef(def)}
                          >
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {def.name}
                              <div className="text-[10px] text-slate-400 font-mono">
                                {def.eval_definition_id}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                                {def.family}
                              </span>
                            </td>
                            <td className="px-4 py-3 capitalize">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                                  def.grader_type === "deterministic"
                                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                                    : def.grader_type === "model_based"
                                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                                      : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}
                              >
                                {def.grader_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px]">{def.target_scope}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  def.severity === "critical"
                                    ? "bg-red-100 text-red-800"
                                    : def.severity === "fail"
                                      ? "bg-orange-100 text-orange-800"
                                      : "bg-slate-100 text-slate-600"
                                }`}
                              >
                                {def.severity}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-slate-500 truncate max-w-xs">
                              {String(def.grader_config["type"] ?? JSON.stringify(def.grader_config))}
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px]">v{def.version}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedDef && (
                <div className="p-4 rounded-lg border border-teal-200 bg-teal-50/30">
                  <div className="flex justify-between items-start">
                    <h3 className="text-sm font-semibold text-teal-900">
                      {selectedDef.name} ({selectedDef.eval_definition_id}@v{selectedDef.version})
                    </h3>
                    <button
                      onClick={() => setSelectedDef(null)}
                      className="text-xs text-teal-700 hover:text-teal-900"
                    >
                      Close
                    </button>
                  </div>
                  <pre className="mt-2 text-[11px] font-mono bg-white p-3 rounded border border-slate-200 text-slate-800 overflow-x-auto">
                    {JSON.stringify(selectedDef, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SUITES */}
          {activeTab === "suites" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suites.length === 0 ? (
                <div className="col-span-2 p-8 text-center text-slate-400 bg-white rounded border border-slate-200">
                  No evaluation suites configured yet.
                </div>
              ) : (
                suites.map((s) => (
                  <div
                    key={`${s.suite_id}@${s.version}`}
                    className="p-5 rounded-lg border border-slate-200 bg-white shadow-sm space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-slate-900">{s.name}</h3>
                        <p className="text-xs text-slate-400 font-mono">
                          {s.suite_id}@v{s.version}
                        </p>
                      </div>
                      <span className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {s.pass_policy.mode}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="text-xs font-medium text-slate-700">Included Definitions ({s.definitions.length}):</div>
                      <div className="flex flex-wrap gap-1">
                        {s.definitions.map((d) => (
                          <span
                            key={d.eval_definition_id}
                            className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-mono"
                          >
                            {d.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="text-xs text-slate-500 pt-2 border-t border-slate-100 flex justify-between">
                      <span>Required Gates: {s.required_eval_ids.length || "All"}</span>
                      <span>Critical Evals: {s.pass_policy.critical_eval_ids?.length || 0}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: DATASETS */}
          {activeTab === "datasets" && (
            <div className="space-y-4">
              {datasets.length === 0 ? (
                <div className="p-8 text-center text-slate-400 bg-white rounded border border-slate-200">
                  No versioned datasets created yet.
                </div>
              ) : (
                datasets.map((ds) => (
                  <div
                    key={`${ds.dataset_id}@${ds.version}`}
                    className="p-5 rounded-lg border border-slate-200 bg-white shadow-sm space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-slate-900">{ds.name}</h3>
                        <p className="text-xs text-slate-400 font-mono">
                          {ds.dataset_id}@v{ds.version} • {ds.cases.length} case(s)
                        </p>
                      </div>
                      <span className="text-xs text-slate-400">Created: {new Date(ds.created_at).toLocaleDateString()}</span>
                    </div>

                    <div className="divide-y divide-slate-100 border border-slate-100 rounded overflow-hidden">
                      {ds.cases.map((c) => (
                        <div key={c.case_id} className="p-3 bg-slate-50/50 text-xs flex justify-between items-center">
                          <div>
                            <span className="font-medium text-slate-800">{c.name}</span>
                            <span className="ml-2 font-mono text-[10px] text-slate-400">{c.case_id}</span>
                            {c.source_run_id && (
                              <span className="ml-2 text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                                from {c.source_run_id}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {c.tags.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px]">
                                {t}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 4: RUNS */}
          {activeTab === "runs" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Runs List */}
              <div className="lg:col-span-1 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase">
                  Execution Runs
                </div>
                <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                  {evalRuns.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400">
                      No post-hoc evaluation runs recorded.
                    </div>
                  ) : (
                    evalRuns.map((r) => (
                      <div
                        key={r.evaluation_run_id}
                        onClick={() => setSelectedRun(r)}
                        className={`p-3 text-xs cursor-pointer transition-colors ${
                          selectedRun?.evaluation_run_id === r.evaluation_run_id
                            ? "bg-teal-50/60 border-l-4 border-teal-600"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-slate-900">{r.suite_id}@v{r.suite_version}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              r.summary.suite_verdict === "PASSED"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {r.summary.suite_verdict}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-1 truncate">
                          {r.evaluation_run_id}
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-500 mt-2">
                          <span>Pass: {(r.summary.pass_rate * 100).toFixed(0)}%</span>
                          <span>Cost: ${r.cost_usd.toFixed(4)}</span>
                          <span>{r.duration_ms}ms</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Run Details */}
              <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white shadow-sm p-5 space-y-4">
                {selectedRun ? (
                  <>
                    <div className="flex justify-between items-start border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="font-bold text-slate-900 text-base">
                          {selectedRun.suite_id}@v{selectedRun.suite_version}
                        </h3>
                        <p className="text-xs text-slate-400 font-mono">{selectedRun.evaluation_run_id}</p>
                      </div>
                      <div className="text-right">
                        <span
                          className={`inline-block px-2.5 py-1 rounded text-xs font-bold uppercase ${
                            selectedRun.summary.suite_verdict === "PASSED"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          Verdict: {selectedRun.summary.suite_verdict}
                        </span>
                        <div className="text-xs text-slate-500 mt-1">
                          Pass Rate: {(selectedRun.summary.pass_rate * 100).toFixed(1)}% ({selectedRun.summary.passed}/{selectedRun.summary.total})
                        </div>
                      </div>
                    </div>

                    <div className="p-3 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      <span className="font-semibold">Verdict Rationale: </span>
                      {selectedRun.summary.verdict_reason}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                        Evaluator Results ({selectedRun.results.length})
                      </h4>
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded overflow-hidden">
                        {selectedRun.results.map((res) => (
                          <div key={res.eval_id} className="p-3 text-xs flex justify-between items-center hover:bg-slate-50">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={res.passed ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                                  {res.passed ? "✓" : "✗"}
                                </span>
                                <span className="font-medium text-slate-900">{res.name}</span>
                                <span className="font-mono text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                  {res.eval_type}
                                </span>
                                <span className="text-[10px] capitalize text-slate-400">
                                  {res.grader_type}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1 pl-4">
                                {res.findings.join("; ") || "No findings recorded"}
                              </div>
                            </div>
                            <div className="text-right">
                              {res.score !== undefined && (
                                <div className="font-mono text-xs font-bold text-slate-700">
                                  {(res.score * 100).toFixed(0)}%
                                </div>
                              )}
                              {res.grader_cost_usd !== undefined && (
                                <div className="text-[10px] text-slate-400">
                                  ${res.grader_cost_usd.toFixed(4)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-12 text-center text-sm text-slate-400">
                    Select an evaluation run to view detailed grader results.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
