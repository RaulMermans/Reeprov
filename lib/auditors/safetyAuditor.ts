import type { Auditor } from "./types";

export const safetyAuditor: Auditor = ({ report }) => ({
  auditor: "safety",
  findings: report.findings.filter((finding) => finding.category === "security"),
});
