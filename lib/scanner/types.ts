export type FileClassification =
  | "agent_config"
  | "prompt"
  | "tool"
  | "eval"
  | "workflow"
  | "documentation"
  | "environment"
  | "package_config"
  | "source_code"
  | "test"
  | "unknown";

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface RepoFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  content?: string;
  classification: FileClassification;
  redacted: boolean;
  secretMatches?: string[];
  ignored: boolean;
  reason?: string;
}

export interface DetectedAgent {
  id: string;
  name: string;
  promptPaths: string[];
  toolNames: string[];
  evalPaths: string[];
  configPath?: string;
  risks: string[];
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

export interface ScanReport {
  repoName: string;
  scannedAt: string;
  filesScanned: number;
  ignoredFiles: number;
  detectedAgents: DetectedAgent[];
  detectedPrompts: string[];
  detectedTools: string[];
  detectedEvals: string[];
  detectedWorkflows: string[];
  findings: Finding[];
  scores: Scores;
  recommendations: string[];
}
