import type { LLMClientResult, LLMGenerateInput } from "@/lib/llm/types";
import type { Finding, RepoFile, ScanReport } from "@/lib/scanner/types";

export interface AuditorContext {
  report: ScanReport;
  files: RepoFile[];
  allowLlmAuditors?: boolean;
  generateLLM?: (input: LLMGenerateInput) => Promise<LLMClientResult>;
}

export interface AuditorResult {
  auditor: string;
  findings: Finding[];
  promptQualityScore?: number;
  auditorStatus?: ScanReport["auditorStatus"];
}

export type Auditor = (context: AuditorContext) => AuditorResult | Promise<AuditorResult>;
