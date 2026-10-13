/**
 * Capability Drift Analysis Engine.
 *
 * Measures dimensional drift across agent version snapshots under explicitly
 * comparable evaluation evidence.
 *
 * Classifies:
 * - IMPROVED vs REGRESSED vs UNCHANGED vs INCONCLUSIVE
 * - Associates configuration diffs without claiming unproven causality.
 * - Supports CAUSALLY_SUPPORTED_WITHIN_EXPERIMENT when isolated in controlled experiments.
 */

import {
  type CapabilitySnapshot,
  type CapabilityDriftReport,
  type DimensionDrift,
  capabilityDriftReportSchema,
} from "../contracts/capability";
import type { ConfigurationDiff } from "../contracts/configuration";
import { saveCapabilityDriftReport } from "./persistence";

export interface AnalyzeDriftOptions {
  reportId?: string;
  baselineSnapshot: CapabilitySnapshot;
  candidateSnapshot: CapabilitySnapshot;
  configDiff?: ConfigurationDiff;
  experimentIsolated?: boolean;
  persist?: boolean;
}

export class CapabilityDriftEngine {
  /**
   * Analyzes multidimensional capability drift between two snapshots.
   */
  static async analyzeDrift(options: AnalyzeDriftOptions): Promise<CapabilityDriftReport> {
    const {
      baselineSnapshot,
      candidateSnapshot,
      configDiff,
      experimentIsolated,
      persist,
    } = options;

    const reportId =
      options.reportId ??
      `drift_${baselineSnapshot.agent_id}_${baselineSnapshot.agent_version}_to_${candidateSnapshot.agent_version}_${Date.now()}`;

    // Extract associated configuration changes
    const associatedChanges: string[] = configDiff?.summary ? [...configDiff.summary] : [];

    const attribution = experimentIsolated
      ? "CAUSALLY_SUPPORTED_WITHIN_EXPERIMENT"
      : "ASSOCIATED_CHANGE";

    const baseDimMap = new Map(baselineSnapshot.dimensions.map((d) => [d.dimension, d]));
    const candDimMap = new Map(candidateSnapshot.dimensions.map((d) => [d.dimension, d]));

    const allDims = Array.from(new Set([...baseDimMap.keys(), ...candDimMap.keys()]));
    const dimensions: DimensionDrift[] = [];

    let improvedCount = 0;
    let regressedCount = 0;

    for (const dim of allDims) {
      const b = baseDimMap.get(dim);
      const c = candDimMap.get(dim);

      const bScore = b ? b.score : 0;
      const cScore = c ? c.score : 0;
      const bPass = b ? b.pass_rate : 0;
      const cPass = c ? c.pass_rate : 0;
      const scoreDelta = cScore - bScore;

      let direction: DimensionDrift["direction"] = "UNCHANGED";
      if (!b || !c) {
        direction = "INCONCLUSIVE";
      } else if (scoreDelta > 0.02) {
        direction = "IMPROVED";
        improvedCount++;
      } else if (scoreDelta < -0.02) {
        direction = "REGRESSED";
        regressedCount++;
      } else {
        direction = "UNCHANGED";
      }

      dimensions.push({
        dimension: dim,
        baseline_score: bScore,
        candidate_score: cScore,
        score_delta: Number(scoreDelta.toFixed(3)),
        baseline_pass_rate: bPass,
        candidate_pass_rate: cPass,
        direction,
        associated_configuration_changes: associatedChanges,
        attribution,
      });
    }

    let overallDrift: CapabilityDriftReport["overall_drift"] = "UNCHANGED";
    if (regressedCount > 0) {
      overallDrift = "REGRESSED";
    } else if (improvedCount > 0) {
      overallDrift = "IMPROVED";
    }

    const summary =
      `Capability comparison: ${candidateSnapshot.agent_version} vs ${baselineSnapshot.agent_version}. ` +
      `${improvedCount} dimension(s) improved, ${regressedCount} regressed, ` +
      `${dimensions.length - improvedCount - regressedCount} unchanged. ` +
      `Attribution level: ${attribution}.`;

    const report: CapabilityDriftReport = capabilityDriftReportSchema.parse({
      report_id: reportId,
      baseline_snapshot_id: baselineSnapshot.capability_snapshot_id,
      candidate_snapshot_id: candidateSnapshot.capability_snapshot_id,
      agent_id: candidateSnapshot.agent_id,
      baseline_version: baselineSnapshot.agent_version,
      candidate_version: candidateSnapshot.agent_version,
      dimensions,
      drift_summary: summary,
      overall_drift: overallDrift,
      created_at: new Date().toISOString(),
    });

    if (persist !== false) {
      await saveCapabilityDriftReport(report);
    }

    return report;
  }
}
