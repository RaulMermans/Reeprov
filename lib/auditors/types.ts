import type { Finding, ScanReport } from "@/lib/scanner/types";

export interface AuditorContext {
  report: ScanReport;
}

export interface AuditorResult {
  auditor: string;
  findings: Finding[];
}

export type Auditor = (context: AuditorContext) => AuditorResult;
