import type { Auditor } from "./types";

export const architectureAuditor: Auditor = ({ report }) => ({
  auditor: "architecture",
  findings:
    report.detectedAgents.length === 0
      ? [
          {
            id: "auditor-no-agent-boundary",
            category: "architecture",
            severity: "medium",
            title: "No clear agent boundary detected",
            summary: "The placeholder architecture auditor did not find an explicit agent inventory.",
            evidencePaths: [],
            recommendation: "Add an agent inventory that names each agent, prompt, tool boundary, and owner.",
            confidence: 0.65,
          },
        ]
      : [],
});
