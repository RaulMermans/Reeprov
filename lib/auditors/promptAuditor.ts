import type { Auditor } from "./types";

export const promptAuditor: Auditor = ({ report }) => ({
  auditor: "prompt",
  findings:
    report.detectedPrompts.length === 0
      ? [
          {
            id: "auditor-no-prompts",
            category: "promptQuality",
            severity: "low",
            title: "No prompt files detected",
            summary: "The placeholder prompt auditor did not find prompt files to review.",
            evidencePaths: [],
            recommendation: "Store important prompts in versioned files so they can be audited and evaluated.",
            confidence: 0.7,
          },
        ]
      : [],
});
