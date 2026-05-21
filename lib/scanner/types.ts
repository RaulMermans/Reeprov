import type { SecretMatch } from "./secretPatterns";

export type FileClassification =
  | "agent_config"
  | "workflow_config"
  | "prompt"
  | "tool"
  | "eval"
  | "workflow"
  | "ci"
  | "documentation"
  | "environment"
  | "package_config"
  | "source_code"
  | "test"
  | "unknown";

// Operational context for artifact origin — finer-grained than FileContext,
// used to classify whether detected agents/prompts/tools come from production
// code vs. examples, tests, docs, or pure UI assets.
export type ArtifactContext =
  | "production"
  | "example"
  | "test"
  | "documentation"
  | "ci"
  | "asset"
  | "unknown";

// Repository mode: the nature of the repo, separate from projectType which
// describes its AI system structure. Used to calibrate scoring policy.
export type RepositoryMode =
  | "ai_application"        // deployed/deployable AI product with agent/workflow behavior
  | "ai_framework_library"  // SDK, framework, or library (e.g. LangChain, CrewAI)
  | "example_template"      // dominated by samples, demos, tutorials, templates
  | "non_ai"                // no meaningful AI system detected
  | "unknown_ai";           // AI signals present but insufficient evidence to classify

export interface RepositoryModeScoringPolicy {
  aiSystemHealthApplicable: boolean;
  generalHygieneApplicable: boolean;
  governanceApplicable: boolean;
  description: string;
}

export interface RepositoryModeResult {
  mode: RepositoryMode;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  evidence: string[];
  scoringPolicy: RepositoryModeScoringPolicy;
}

// New score dimensions alongside the legacy per-category scores.
export interface ScoreDimensions {
  aiSystemHealth: number | null;     // null when mode is non_ai / framework / example
  generalRepoHygiene: number;        // always computed
  governanceCompleteness: number | null; // null when not applicable
  graphMappingCompleteness: number;  // 0–100, based on mapped relationships
  confidence: "high" | "medium" | "low";
  legacyOverallScore: number;        // preserved for backward compatibility
}

// A deterministic cap applied to a score dimension during gate evaluation.
export interface ScoreCap {
  dimension: string;
  cap: number;
  reason: string;
  evidence: string[];
}

// Graph completeness: measures mapped relationships, not raw artifact counts.
export interface GraphCompletenessMetrics {
  mappedAgents: number;
  totalAgents: number;
  mappedPrompts: number;
  totalPrompts: number;
  mappedTools: number;
  totalTools: number;
  mappedEvals: number;
  totalEvals: number;
  workflowStepsWithAgent: number;
  totalWorkflowSteps: number;
  workflowStepsWithPrompt: number;
  workflowStepsWithModel: number;
  workflowStepsWithEval: number;
  completenessScore: number;  // 0–100 weighted composite
}

// A single eval/performance result parsed from eval-results.json etc.
export interface EvalPerformanceResult {
  agent?: string;
  workflow?: string;
  model?: string;
  provider?: string;
  score?: number;
  latencyMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  pass?: boolean;
  sourcePath: string;
}

export interface PerformanceData {
  available: boolean;
  results: EvalPerformanceResult[];
  evalResultCount: number;
  resultFiles: string[];
}

// Operational context of a file — used to calibrate secret severity.
export type FileContext =
  | "production"
  | "test"
  | "documentation"
  | "ci"
  | "example"
  | "config"
  | "migration"
  | "unknown";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type ProjectType =
  | "agent_system"
  | "workflow_system"
  | "hybrid_workflow_agent"
  | "ai_application"
  | "unknown_ai_project";

export interface RepoFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  content?: string;
  classification: FileClassification;
  fileContext?: FileContext;
  redacted: boolean;
  secretMatches?: string[];
  secretMatchDetails?: SecretMatch[];
  ignored: boolean;
  reason?: string;
}

// Clearer UI display kind for agent cards and exports.
// - manifest: parsed entry from agents.yaml / agents.json
// - agent_file: unstructured file in /agents/ dir, *_agent.py, *_evaluator.py
// - inferred_candidate: inferred only from prompt files, no config found
export type AgentDisplayKind = "manifest" | "agent_file" | "inferred_candidate";

export interface DetectedAgent {
  id: string;
  name: string;
  promptPaths: string[];
  toolNames: string[];
  evalPaths: string[];
  configPath?: string;
  risks: string[];
  source: "explicit" | "inferred";
  confidence: "low" | "medium" | "high";
  evidenceReason?: string;
  displayKind?: AgentDisplayKind;
}

export interface DetectedWorkflow {
  id: string;
  name: string;
  type?: "deterministic_workflow" | "workflow_with_tools" | "hybrid_workflow_agent" | "unknown";
  stages?: string[];
  tools?: string[];
  evals?: string[];
  configPath?: string;
  risks?: string[];
  source: "explicit" | "inferred";
  confidence: "low" | "medium" | "high";
  evidenceReason?: string;
}

export interface DetectedCIWorkflow {
  name: string;
  path: string;
  provider: "github_actions" | "gitlab" | "circleci" | "unknown";
}

export interface EvidenceSnippet {
  path: string;
  excerpt: string;
  redacted: boolean;
}

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  summary: string;
  evidencePaths: string[];
  recommendation: string;
  confidence: number;
  evidenceSnippets?: EvidenceSnippet[];
}

export interface Scores {
  architecture: number;
  promptQuality: number;
  toolGovernance: number;
  evalCoverage: number;
  security: number;
  documentation: number;
  overall: number;
}

export interface ScanSource {
  type: "github" | "zip" | "mock";
  label: string;
  owner?: string;
  repo?: string;
  filename?: string;
}

export interface ZipScanStats {
  totalEntries: number;
  totalFiles: number;
  candidateFiles: number;
  scannedFiles: number;
  skippedByFileLimit: number;
  strippedRootFolder?: string;
}

export interface ScanReport {
  reportVersion: string;
  repoName: string;
  scanSource?: ScanSource;
  zipStats?: ZipScanStats;
  scannedAt: string;
  filesScanned: number;
  ignoredFiles: number;
  projectType: ProjectType;
  // v2 governance fields — all optional for backward compatibility
  repositoryMode?: RepositoryModeResult;
  scoreDimensions?: ScoreDimensions;
  scoreCapsApplied?: ScoreCap[];
  graphCompleteness?: GraphCompletenessMetrics;
  performanceData?: PerformanceData;
  detectedAgents: DetectedAgent[];
  detectedWorkflowsDetailed: DetectedWorkflow[];
  detectedCIWorkflows: DetectedCIWorkflow[];
  detectedPrompts: string[];
  detectedPromptRelatedFiles?: string[];
  detectedTools: string[];
  detectedEvals: string[];
  detectedTests: string[];
  detectedWorkflows: string[];
  findings: Finding[];
  scores: Scores;
  recommendations: string[];
  auditorStatus?: {
    llmAuditorsEnabled: boolean;
    promptAuditorRan: boolean;
    provider?: string;
    model?: string;
    error?: string;
  };
}
