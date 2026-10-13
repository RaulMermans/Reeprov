"use client";

import React, { useState, useEffect } from "react";
import type {
  RegressionBaseline,
  RegressionGateResult,
  RegressionReport,
  RegressionFinding,
  RegressionCaseResult,
} from "@/lib/core/contracts/regression";
import type {
  CapabilitySnapshot,
  CapabilityDriftReport,
  CapabilityHistory,
} from "@/lib/core/contracts/capability";
import type {
  PolicyBehaviorSnapshot,
  PolicyDriftReport,
} from "@/lib/core/contracts/policyDrift";
import type { ReleaseEvidenceSnapshot } from "@/lib/core/contracts/releaseEvidence";

type StudioTab =
  | "gate"
  | "findings"
  | "matrix"
  | "baselines"
  | "curation"
  | "capabilities"
  | "policy";

export function RegressionStudioView() {
  const [activeTab, setActiveTab] = useState<StudioTab>("gate");
  const [loading, setLoading] = useState(true);

  // Data states
  const [baselines, setBaselines] = useState<RegressionBaseline[]>([]);
  const [selectedBaseline, setSelectedBaseline] = useState<RegressionBaseline | null>(null);
  const [reports, setReports] = useState<RegressionReport[]>([]);
  const [currentReport, setCurrentReport] = useState<RegressionReport | null>(null);
  const [currentGate, setCurrentGate] = useState<RegressionGateResult | null>(null);

  const [snapshots, setSnapshots] = useState<CapabilitySnapshot[]>([]);
  const [capabilityHistory, setCapabilityHistory] = useState<CapabilityHistory | null>(null);
  const [policyReports, setPolicyReports] = useState<PolicyDriftReport[]>([]);
  const [releases, setReleases] = useState<ReleaseEvidenceSnapshot[]>([]);

  // Baseline approval modal
  const [showBaselineModal, setShowBaselineModal] = useState(false);
  const [newBaselineRunId, setNewBaselineRunId] = useState("");
  const [newBaselineSuiteId, setNewBaselineSuiteId] = useState("");
  const [newBaselineReason, setNewBaselineReason] = useState("");
  const [approverName, setApproverName] = useState("qa_lead");

  // Gate evaluation form
  const [evalCandidateRunId, setEvalCandidateRunId] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Failure curation form
  const [showCurateModal, setShowCurateModal] = useState(false);
  const [curateRunId, setCurateRunId] = useState("");
  const [curateDatasetId, setCurateDatasetId] = useState("regression-suite-v1");
  const [curateCaseName, setCurateCaseName] = useState("");
  const [curateCategory, setCurateCategory] = useState("TASK_FAILURE");
  const [curateIncident, setCurateIncident] = useState("INC-9482");

  useEffect(() => {
    async function loadStudioData() {
      try {
        setLoading(true);
        const [baseRes, repRes, capRes, polRes, relRes] = await Promise.all([
          fetch("/api/baselines").then((r) => (r.ok ? r.json() : { baselines: [] })),
          fetch("/api/regressions/reports").then((r) => (r.ok ? r.json() : { reports: [] })),
          fetch("/api/capabilities/snapshots").then((r) => (r.ok ? r.json() : { snapshots: [] })),
          fetch("/api/policy-drift").then((r) => (r.ok ? r.json() : { reports: [] })),
          fetch("/api/releases").then((r) => (r.ok ? r.json() : { releases: [] })),
        ]);

        const loadedBaselines: RegressionBaseline[] = baseRes.baselines ?? [];
        setBaselines(loadedBaselines);
        if (loadedBaselines.length > 0) {
          setSelectedBaseline(loadedBaselines[0]);
        }

        const loadedReports: RegressionReport[] = repRes.reports ?? [];
        setReports(loadedReports);
        if (loadedReports.length > 0) {
          setCurrentReport(loadedReports[0]);
        }

        const loadedSnapshots: CapabilitySnapshot[] = capRes.snapshots ?? [];
        setSnapshots(loadedSnapshots);
        if (loadedSnapshots.length > 0) {
          const agentId = loadedSnapshots[0].agent_id;
          fetch(`/api/capabilities/drift?history=true&agent_id=${agentId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.history) setCapabilityHistory(data.history);
            })
            .catch(() => {});
        }

        setPolicyReports(polRes.reports ?? []);
        setReleases(relRes.releases ?? []);
      } catch (err) {
        console.error("Failed to load Regression Studio data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadStudioData();
  }, []);

  async function handleRunRegressionCheck() {
    if (!selectedBaseline || !evalCandidateRunId) return;
    try {
      setEvaluating(true);
      setEvalError(null);
      const res = await fetch("/api/regressions/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseline_id: selectedBaseline.baseline_id,
          candidate_run_id: evalCandidateRunId,
          persist: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Regression check failed");
      }

      const data = await res.json();
      setCurrentGate(data.gateResult);
      setCurrentReport(data.report);
      setReports((prev) => [data.report, ...prev]);
    } catch (err) {
      setEvalError((err as Error).message);
    } finally {
      setEvaluating(false);
    }
  }

  async function handleApproveBaseline() {
    if (!newBaselineRunId || !newBaselineSuiteId) return;
    try {
      const res = await fetch("/api/baselines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: newBaselineRunId,
          eval_suite_id: newBaselineSuiteId,
          approved_by: approverName,
          label: newBaselineReason || "Approved canonical baseline",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBaselines((prev) => [data.baseline, ...prev]);
        setSelectedBaseline(data.baseline);
        setShowBaselineModal(false);
        setNewBaselineRunId("");
        setNewBaselineSuiteId("");
        setNewBaselineReason("");
      }
    } catch (err) {
      console.error("Failed to approve baseline:", err);
    }
  }

  async function handleCurateFailure() {
    if (!curateRunId || !curateCaseName) return;
    try {
      const res = await fetch("/api/regressions/curate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: curateRunId,
          dataset_id: curateDatasetId,
          case_name: curateCaseName,
          expected_behavior: "Expected agent to satisfy security bounds without regression",
          failure_category: curateCategory,
          curated_by: "qa_engineer",
          source_incident: curateIncident,
        }),
      });
      if (res.ok) {
        setShowCurateModal(false);
        setCurateRunId("");
        setCurateCaseName("");
      }
    } catch (err) {
      console.error("Failed to curate failure:", err);
    }
  }

  const findings = currentReport?.findings ?? [];
  const caseMatrix = currentReport?.case_matrix ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Regression Studio
            </h1>
            <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 border border-teal-200">
              Continuous Evidence Gate
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Determine whether candidate agent versions qualify for promotion against immutable baselines.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBaselineModal(true)}
            className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-500 transition"
          >
            + Set Baseline
          </button>
          <button
            onClick={() => setShowCurateModal(true)}
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
          >
            Curate Failure
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto pb-1">
        {[
          { id: "gate", label: "Release Gate" },
          { id: "findings", label: `Regression Findings (${findings.length})` },
          { id: "matrix", label: `Case Matrix (${caseMatrix.length})` },
          { id: "baselines", label: `Baselines (${baselines.length})` },
          { id: "curation", label: "Curated Tests" },
          { id: "capabilities", label: "Capability History" },
          { id: "policy", label: `Policy Drift (${policyReports.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as StudioTab)}
            className={`whitespace-nowrap rounded-t-lg px-4 py-2.5 text-xs font-medium transition ${
              activeTab === tab.id
                ? "border-b-2 border-teal-600 text-teal-700 bg-teal-50/50"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Release Gate */}
      {activeTab === "gate" && (
        <div className="space-y-6">
          {/* Gate Evaluation Trigger Bar */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Baseline Reference
                </label>
                <select
                  value={selectedBaseline?.baseline_id ?? ""}
                  onChange={(e) => {
                    const found = baselines.find((b) => b.baseline_id === e.target.value);
                    if (found) setSelectedBaseline(found);
                  }}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                >
                  {baselines.map((b) => (
                    <option key={b.baseline_id} value={b.baseline_id}>
                      [{b.status}] {b.baseline_id} ({b.label || b.eval_suite_id})
                    </option>
                  ))}
                  {baselines.length === 0 && <option value="">No baselines registered</option>}
                </select>
              </div>

              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Candidate Run ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. run_candidate_agent_v2"
                  value={evalCandidateRunId}
                  onChange={(e) => setEvalCandidateRunId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="sm:self-end">
                <button
                  onClick={handleRunRegressionCheck}
                  disabled={evaluating || !selectedBaseline || !evalCandidateRunId}
                  className="w-full sm:w-auto rounded-md bg-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-500 disabled:opacity-50 transition"
                >
                  {evaluating ? "Evaluating Gate..." : "Evaluate Gate"}
                </button>
              </div>
            </div>

            {evalError && (
              <p className="mt-2 text-xs text-rose-600 font-medium">{evalError}</p>
            )}
          </div>

          {/* Gate Verdict Card */}
          {currentGate ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-md px-3 py-1 text-sm font-bold ${
                        currentGate.status === "PASS"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : currentGate.status === "WARN"
                          ? "bg-amber-50 text-amber-700 border border-amber-200"
                          : currentGate.status === "FAIL"
                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                          : "bg-slate-100 text-slate-700 border border-slate-300"
                      }`}
                    >
                      GATE VERDICT: {currentGate.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      Policy: {currentGate.policy_id} (v{currentGate.policy_version})
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Candidate: <code className="font-mono text-slate-800">{currentGate.candidate_run_id}</code> |
                    Baseline: <code className="font-mono text-slate-800">{currentGate.baseline_id}</code>
                  </p>
                </div>

                <div className="rounded-lg bg-slate-900 px-4 py-2 text-right">
                  <div className="text-[10px] font-mono text-slate-400">CI EXIT CODE</div>
                  <div className="text-lg font-mono font-bold text-teal-400">
                    {currentGate.status === "PASS"
                      ? "0 (PROCEED)"
                      : currentGate.status === "FAIL"
                      ? "1 (BLOCK_RELEASE)"
                      : "2 (INCONCLUSIVE)"}
                  </div>
                </div>
              </div>

              {/* Summary Stats Grid */}
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Comparability</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {currentGate.comparability?.verdict ?? "COMPARABLE"}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Critical Regressions</div>
                  <div
                    className={`mt-1 text-sm font-semibold ${
                      (currentGate.critical_failure_count ?? 0) > 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {currentGate.critical_failure_count ?? 0}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Total Findings</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {currentGate.findings?.length ?? 0}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-[11px] font-medium text-slate-500">Gate Failure Reasons</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {currentGate.failure_reasons?.length ?? 0}
                  </div>
                </div>
              </div>

              {/* Gate Reasons List */}
              {currentGate.failure_reasons.length > 0 && (
                <div className="mt-6 rounded-lg bg-rose-50/50 border border-rose-200 p-4">
                  <h4 className="text-xs font-semibold text-rose-800">Violations Blocking Promotion:</h4>
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-xs text-rose-700">
                    {currentGate.failure_reasons.map((r, idx) => (
                      <li key={idx}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 mb-3">
                ⚖️
              </div>
              <h3 className="text-sm font-medium text-slate-900">No Regression Evaluation Loaded</h3>
              <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
                Select an approved baseline and enter a candidate run ID to execute continuous regression gate checks.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Findings */}
      {activeTab === "findings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Evaluated Regression Findings ({findings.length})
            </h3>
            <span className="text-xs text-slate-500">
              Deterministic taxonomy with causal attribution
            </span>
          </div>

          {findings.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-3 py-3 font-semibold">Severity</th>
                    <th className="px-4 py-3 font-semibold">Delta</th>
                    <th className="px-4 py-3 font-semibold">Baseline Evidence</th>
                    <th className="px-4 py-3 font-semibold">Candidate Evidence</th>
                    <th className="px-4 py-3 font-semibold">Associated Config Diff</th>
                    <th className="px-3 py-3 font-semibold">Divergence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {findings.map((f) => (
                    <tr key={f.finding_id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono font-medium text-slate-900">
                        {f.category}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            f.severity === "CRITICAL"
                              ? "bg-rose-100 text-rose-800"
                              : f.severity === "FAIL"
                              ? "bg-orange-100 text-orange-800"
                              : f.severity === "WARNING"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {f.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        {f.delta ? JSON.stringify(f.delta) : "PASS → FAIL"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">
                        {JSON.stringify(f.baseline_evidence)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">
                        {JSON.stringify(f.candidate_evidence)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {f.configuration_differences?.join(", ") || "None identified"}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-teal-600">
                        {f.first_meaningful_divergence ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No regression findings detected for the selected report.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Case Matrix */}
      {activeTab === "matrix" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Paired Case Matrix ({caseMatrix.length} cases)
            </h3>
            <span className="text-xs text-slate-500">
              Direct comparison across identical dataset case IDs
            </span>
          </div>

          {caseMatrix.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Case ID</th>
                    <th className="px-3 py-3 font-semibold">Transition Status</th>
                    <th className="px-4 py-3 font-semibold">Baseline Result</th>
                    <th className="px-4 py-3 font-semibold">Candidate Result</th>
                    <th className="px-3 py-3 font-semibold">Score Delta</th>
                    <th className="px-3 py-3 font-semibold">Duration Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {caseMatrix.map((cm) => (
                    <tr key={cm.case_id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono font-medium text-slate-900">
                        {cm.case_id}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            cm.status_transition === "NEW_REGRESSION"
                              ? "bg-rose-100 text-rose-800"
                              : cm.status_transition === "RECOVERED"
                              ? "bg-emerald-100 text-emerald-800"
                              : cm.status_transition === "EXISTING_FAILURE"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {cm.status_transition}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px]">{cm.baseline_status}</span>
                        {typeof cm.baseline_score === "number" ? ` (${(cm.baseline_score * 100).toFixed(0)}%)` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[11px]">{cm.candidate_status}</span>
                        {typeof cm.candidate_score === "number" ? ` (${(cm.candidate_score * 100).toFixed(0)}%)` : ""}
                      </td>
                      <td
                        className={`px-3 py-3 font-semibold ${
                          typeof cm.score_delta === "number" && cm.score_delta < 0
                            ? "text-rose-600"
                            : typeof cm.score_delta === "number" && cm.score_delta > 0
                            ? "text-emerald-600"
                            : "text-slate-500"
                        }`}
                      >
                        {typeof cm.score_delta === "number"
                          ? cm.score_delta > 0
                            ? `+${(cm.score_delta * 100).toFixed(1)}%`
                            : `${(cm.score_delta * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                        {cm.divergence_step_index !== undefined ? `Step ${cm.divergence_step_index}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No paired case matrix data available.
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Baselines */}
      {activeTab === "baselines" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Explicit Regression Baselines ({baselines.length})
            </h3>
            <span className="text-xs text-slate-500">
              Immutable historical evidence references
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {baselines.map((b) => (
              <div
                key={b.baseline_id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 transition"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${
                      b.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : b.status === "SUPERSEDED"
                        ? "bg-slate-100 text-slate-600 border border-slate-200"
                        : "bg-rose-50 text-rose-700 border border-rose-200"
                    }`}
                  >
                    {b.status}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {new Date(b.approved_at).toLocaleDateString()}
                  </span>
                </div>

                <h4 className="mt-2 text-sm font-bold text-slate-900">{b.baseline_id}</h4>
                <p className="text-xs text-slate-500">{b.label || "Canonical Baseline"}</p>

                <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600 font-mono">
                  <div>Suite: {b.eval_suite_id}@v{b.eval_suite_version}</div>
                  <div>Dataset: {b.dataset_id ? `${b.dataset_id}@v${b.dataset_version}` : "None"}</div>
                  <div>Approved By: {b.approved_by || "system"}</div>
                  <div className="truncate text-slate-400 text-[10px]">Hash: {b.evidence_hash}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Curated Failure Tests */}
      {activeTab === "curation" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Curated Production Failures as Regression Tests
            </h3>
            <span className="text-xs text-slate-500">
              Failures converted into permanent release criteria
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-xs text-slate-600 space-y-2">
              <p>
                When a production failure occurs:
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-slate-700">
                <li>Capture run artifact & diagnose failure mode in Diagnostic Engine.</li>
                <li>Human reviewer confirms failure represents non-negotiable policy or capability.</li>
                <li>Curate into a permanent EvalCase inside a versioned regression dataset.</li>
                <li>All future release candidates must execute against this case and pass.</li>
              </ol>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4 flex justify-end">
              <button
                onClick={() => setShowCurateModal(true)}
                className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-teal-500 transition"
              >
                + Curate Production Failure
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Capability History */}
      {activeTab === "capabilities" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Multi-Dimensional Capability History
            </h3>
            <span className="text-xs text-slate-500">
              Longitudinal capability tracking across agent versions
            </span>
          </div>

          {capabilityHistory && capabilityHistory.snapshots.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Version</th>
                    <th className="px-3 py-3 font-semibold">Captured</th>
                    <th className="px-3 py-3 font-semibold">Task Success</th>
                    <th className="px-3 py-3 font-semibold">Tool Use</th>
                    <th className="px-3 py-3 font-semibold">Retrieval</th>
                    <th className="px-3 py-3 font-semibold">Safety</th>
                    <th className="px-3 py-3 font-semibold">Approval</th>
                    <th className="px-3 py-3 font-semibold">Cost</th>
                    <th className="px-3 py-3 font-semibold">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-700">
                  {capabilityHistory.snapshots.map((snap) => {
                    const getScore = (dim: string) => {
                      const d = snap.dimensions.find((x) => x.dimension === dim);
                      return d ? `${(d.score * 100).toFixed(0)}%` : "—";
                    };
                    return (
                      <tr key={snap.capability_snapshot_id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {snap.agent_version}
                        </td>
                        <td className="px-3 py-3 text-slate-400">
                          {new Date(snap.captured_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3 font-semibold">{getScore("TASK_SUCCESS")}</td>
                        <td className="px-3 py-3 font-semibold">{getScore("TOOL_USE")}</td>
                        <td className="px-3 py-3 font-semibold">{getScore("RETRIEVAL")}</td>
                        <td className="px-3 py-3 font-semibold text-emerald-600">{getScore("SAFETY")}</td>
                        <td className="px-3 py-3 font-semibold">{getScore("APPROVAL_COMPLIANCE")}</td>
                        <td className="px-3 py-3 font-semibold">{getScore("COST_EFFICIENCY")}</td>
                        <td className="px-3 py-3 font-semibold">{getScore("LATENCY")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              No capability snapshots recorded yet. Run evaluations across agent versions to build history.
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Policy Drift */}
      {activeTab === "policy" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">
              Declared vs Behavioral Policy Drift ({policyReports.length})
            </h3>
            <span className="text-xs text-slate-500">
              Detect permission expansions and bypasses
            </span>
          </div>

          <div className="space-y-4">
            {policyReports.map((p) => (
              <div
                key={p.drift_report_id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs font-bold ${
                        p.has_critical_drift
                          ? "bg-rose-100 text-rose-800 border border-rose-200"
                          : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      }`}
                    >
                      {p.has_critical_drift ? "CRITICAL POLICY DRIFT" : "CLEAN"}
                    </span>
                    <span className="font-mono text-xs text-slate-700">
                      {p.baseline_run_id} → {p.candidate_run_id}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {new Date(p.created_at).toLocaleString()}
                  </span>
                </div>

                <div className="mt-3">
                  {(() => {
                    const driftFindings = p.findings ?? p.drift_findings ?? [];
                    return (
                      <>
                        <h5 className="text-xs font-semibold text-slate-700">Findings ({driftFindings.length}):</h5>
                        <ul className="mt-2 space-y-2">
                          {driftFindings.map((f) => (
                            <li
                              key={f.finding_id}
                              className={`rounded-lg p-2.5 text-xs border ${
                                f.severity === "CRITICAL"
                                  ? "bg-rose-50/50 border-rose-200 text-rose-900"
                                  : f.severity === "FAIL"
                                  ? "bg-orange-50/50 border-orange-200 text-orange-900"
                                  : f.severity === "WARNING"
                                  ? "bg-amber-50/50 border-amber-200 text-amber-900"
                                  : "bg-slate-50 border-slate-200 text-slate-800"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold">{f.drift_type}</span>
                                <span className="font-semibold text-[10px]">{f.severity}</span>
                              </div>
                              <p className="mt-1 text-slate-600">{f.description}</p>
                            </li>
                          ))}
                          {driftFindings.length === 0 && (
                            <li className="text-xs text-slate-400 italic">No policy drift findings detected.</li>
                          )}
                        </ul>
                      </>
                    );
                  })()}
                </div>
              </div>
            ))}

            {policyReports.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                No policy drift reports generated yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Approve Baseline Modal */}
      {showBaselineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Approve Canonical Regression Baseline
            </h3>
            <p className="text-xs text-slate-500">
              Baseline decisions are immutable. Once approved, this run provides the golden reference for candidate gates.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Canonical Run ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. run_support_agent_prod_gold"
                  value={newBaselineRunId}
                  onChange={(e) => setNewBaselineRunId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Eval Suite ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. release-qualification-suite"
                  value={newBaselineSuiteId}
                  onChange={(e) => setNewBaselineSuiteId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Approval Rationale
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production release 1.4.0 verified"
                  value={newBaselineReason}
                  onChange={(e) => setNewBaselineReason(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Approver Identity
                </label>
                <input
                  type="text"
                  value={approverName}
                  onChange={(e) => setApproverName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowBaselineModal(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveBaseline}
                disabled={!newBaselineRunId || !newBaselineSuiteId}
                className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
              >
                Approve & Seal Baseline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Curate Failure Modal */}
      {showCurateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              Curate Production Failure Case
            </h3>
            <p className="text-xs text-slate-500">
              Convert an unhandled production failure run into a permanent regression test case.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Source Failed Run ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. run_prod_failure_incident"
                  value={curateRunId}
                  onChange={(e) => setCurateRunId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Target Dataset ID
                </label>
                <input
                  type="text"
                  value={curateDatasetId}
                  onChange={(e) => setCurateDatasetId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Case Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. case_refund_policy_bypass_attempt"
                  value={curateCaseName}
                  onChange={(e) => setCurateCaseName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Failure Category
                </label>
                <select
                  value={curateCategory}
                  onChange={(e) => setCurateCategory(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                >
                  <option value="SAFETY_VIOLATION">SAFETY_VIOLATION</option>
                  <option value="POLICY_BYPASS">POLICY_BYPASS</option>
                  <option value="TOOL_CALL_ERROR">TOOL_CALL_ERROR</option>
                  <option value="TASK_FAILURE">TASK_FAILURE</option>
                  <option value="CONTEXT_OVERFLOW">CONTEXT_OVERFLOW</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Source Incident Ref
                </label>
                <input
                  type="text"
                  value={curateIncident}
                  onChange={(e) => setCurateIncident(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setShowCurateModal(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCurateFailure}
                disabled={!curateRunId || !curateCaseName}
                className="rounded-lg bg-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
              >
                Seal as Permanent Test
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
