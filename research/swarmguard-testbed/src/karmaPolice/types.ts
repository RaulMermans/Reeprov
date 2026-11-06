/**
 * KARMA POLICE — Cross-Agent Evidence Verification Engine
 * Types and Contracts.
 *
 * Provides typed evidence relationships, provenance findings,
 * and diagnostic exports conforming to the research runtime.
 */

import { z } from "zod";
import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import type { TestResult } from "../../../../lib/core/contracts/evidence";
import type { AgentHandoff } from "../../../../lib/core/contracts/handoff";
import {
  type MonitorClass,
  monitorClassSchema,
  type ClaimPrediction,
  type ObservableClaim,
  type MonitorResult,
} from "../baselines/schema";
import type { DetectorEvidence } from "../detector";

export const KARMA_POLICE_MONITOR_ID = "karma_police.cross_agent.v1" as const;
export const KARMA_POLICE_MONITOR_VERSION = "1.0.0" as const;
export const KARMA_POLICE_FINDINGS_FORMAT = "reeprov.karma_police.findings.v1" as const;

export const provenanceAnomalyKindSchema = z.enum([
  "cross_run_reference",
  "unresolved_reference",
  "stale_artifact_reference",
  "unexecuted_observation",
  "missing_resolving_evidence",
  "producer_delivered_mismatch",
  "incomplete_capture",
  "none",
]);
export type ProvenanceAnomalyKind = z.infer<typeof provenanceAnomalyKindSchema>;

export const claimProvenanceFindingSchema = z.object({
  claim_id: z.string(),
  originating_agent_id: z.string(),
  event_or_handoff_id: z.string().optional(),
  event_kind: z.enum(["assertion", "handoff"]),
  evidence_identifiers_considered: z.array(z.string()),
  supporting_evidence_ids: z.array(z.string()),
  contradicting_evidence_ids: z.array(z.string()),
  provenance_anomalies: z.array(provenanceAnomalyKindSchema),
  capture_completeness: z.enum(["complete", "incomplete", "partial"]),
  classification: monitorClassSchema,
  classification_rationale: z.string(),
  limitations: z.array(z.string()),
});
export type ClaimProvenanceFinding = z.infer<typeof claimProvenanceFindingSchema>;

export const karmaPoliceFindingsReportSchema = z.object({
  format: z.literal(KARMA_POLICE_FINDINGS_FORMAT),
  monitor_id: z.literal(KARMA_POLICE_MONITOR_ID),
  monitor_version: z.string(),
  run_id: z.string(),
  case_id: z.string().optional(),
  domain_id: z.string(),
  findings: z.array(claimProvenanceFindingSchema),
  summary: z.object({
    total_claims: z.number().nonnegative(),
    supported_claims: z.number().nonnegative(),
    contradicted_claims: z.number().nonnegative(),
    unverified_claims: z.number().nonnegative(),
    provenance_anomalies_detected: z.number().nonnegative(),
  }),
});
export type KarmaPoliceFindingsReport = z.infer<typeof karmaPoliceFindingsReportSchema>;

export interface EvidenceReferenceResolution {
  ref: string;
  status: "in_run" | "cross_run" | "stale" | "unresolved" | "malformed";
  target_type?: "artifact" | "tool" | "test" | "step" | "record";
  target_id?: string;
  producer_agent_id?: string;
  note?: string;
}

export interface IndexedArtifact {
  artifact_id: string;
  name: string;
  version?: string;
  producer_agent_id?: string;
  step_id?: string;
  type: string;
  uri?: string;
  hash?: string;
  isStale: boolean;
  body?: unknown;
  metadata?: Record<string, unknown>;
  associatedTests: TestResult[];
}

export interface IndexedTool {
  tool_call_id: string;
  tool_name: string;
  agent_id?: string;
  status: string;
  input?: unknown;
  output?: unknown;
  output_summary?: string;
  step_id?: string;
  isValidation: boolean;
  isArtifactWriter: boolean;
  isRecordReader: boolean;
}

export interface IndexedRecord {
  id: string;
  kind: "system_log" | "witness" | "rumor" | string;
  body?: string;
  timestamp?: string;
}

export interface KarmaPoliceEvidenceIndex {
  runId: string;
  artifact: RunArtifact;
  artifactsById: Map<string, IndexedArtifact>;
  artifactsByVersion: Map<string, IndexedArtifact>;
  latestArtifactByName: Map<string, IndexedArtifact>;
  toolsById: Map<string, IndexedTool>;
  toolsByAgent: Map<string, IndexedTool[]>;
  validationTools: IndexedTool[];
  testsById: Map<string, TestResult>;
  testsByArtifact: Map<string, TestResult[]>;
  passedTests: TestResult[];
  failedTests: TestResult[];
  recordsById: Map<string, IndexedRecord>;
  producerOutputsByAgent: Map<string, { output?: unknown; assertions?: unknown[] }>;
  handoffsById: Map<string, AgentHandoff>;
  handoffsBySender: Map<string, AgentHandoff[]>;
  resolveReference: (ref: string) => EvidenceReferenceResolution;
}

export interface KarmaPoliceOptions {
  caseId?: string;
  domainId?: string;
  includeFindings?: boolean;
}

export interface KarmaPoliceExecutionOutput {
  result: MonitorResult;
  findings: KarmaPoliceFindingsReport;
}
