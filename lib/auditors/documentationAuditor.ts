import type { Auditor } from "./types";

export const documentationAuditor: Auditor = ({ report }) => ({
  auditor: "documentation",
  findings:
    report.findings.some((finding) => finding.id === "missing-agents-md")
      ? []
      : [
          {
            id: "auditor-docs-present",
            category: "documentation",
            severity: "info",
            title: "Agent documentation detected",
            summary: "The placeholder documentation auditor found at least one AGENTS.md-style file.",
            evidencePaths: [],
            recommendation: "Keep this document updated as agent responsibilities and tools change.",
            confidence: 0.6,
          },
        ],
});
