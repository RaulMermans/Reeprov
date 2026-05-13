import { runAuditors } from "@/lib/auditors/runAuditors";
import { prepareRepoFiles, staticScanFromFiles } from "@/lib/scanner/staticScan";
import type { ScanReport, ScanSource, ZipScanStats } from "@/lib/scanner/types";
import { scanReportSchema } from "./reportSchema";

interface RunScanPipelineInput {
  repoName: string;
  files: Array<{
    path: string;
    size: number;
    content?: string;
  }>;
  scanSource?: ScanSource;
  zipStats?: ZipScanStats;
  githubTreeTruncated?: boolean;
  allowLlmAuditors?: boolean;
}

export async function runScanPipeline(input: RunScanPipelineInput): Promise<ScanReport> {
  const files = prepareRepoFiles(input.files);
  const staticReport = staticScanFromFiles(input.repoName, files, {
    githubTreeTruncated: input.githubTreeTruncated,
    scanSource: input.scanSource,
    zipStats: input.zipStats,
  });
  const report = await runAuditors(staticReport, files, {
    allowLlmAuditors: input.allowLlmAuditors,
  });

  return scanReportSchema.parse(report);
}
