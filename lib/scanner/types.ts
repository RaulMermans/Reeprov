import type { SecretMatch } from "./secretPatterns";

// Artifact scope: distinguishes product AI system files from developer tooling.
export type ArtifactScope =
  | "product"
  | "assistant_tooling"
  | "ci"
  | "docs"
  | "tests"
  | "example"
  | "unknown";

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

// Developer-assistant artifact (Claude skill, Cursor rule, VS Code config, etc.).
// Reported separately and excluded from product agent/workflow counts.
export interface DetectedAssistantTooling {
  path: string;
  kind: "claude_skill" | "cursor_rule" | "vscode_config" | "assistant_prompt" | "assistant_agent" | "other";
  label?: string;
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
  maintainability: number;
  overall: number;
}

// Maintainability metrics attached to a ScanReport when the maintainability auditor runs.
export interface MaintainabilityMetrics {
  largeFiles: Array<{ path: string; lineCount: number; reason: string }>;
  todoMarkers: Array<{ path: string; count: number }>;
  hotspots: Array<{ path: string; signals: string[] }>;
  summary: string;
  score: number;
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
  detectedAgents: DetectedAgent[];
  detectedWorkflowsDetailed: DetectedWorkflow[];
  detectedCIWorkflows: DetectedCIWorkflow[];
  detectedAssistantTooling?: DetectedAssistantTooling[];
  detectedPrompts: string[];
  detectedPromptRelatedFiles?: string[];
  detectedLLMInfrastructure?: string[];
  detectedTools: string[];
  detectedEvals: string[];
  detectedTests: string[];
  detectedWorkflows: string[];
  maintainability?: MaintainabilityMetrics;
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
