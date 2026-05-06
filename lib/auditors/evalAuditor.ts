import type { Auditor } from "./types";

export const evalAuditor: Auditor = () => ({
  auditor: "eval",
  findings: [],
});
