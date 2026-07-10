import { randomBytes } from "node:crypto";

export function generateDiagnosticId(): string {
  const tsBase36 = Date.now().toString(36);
  const rand = randomBytes(2).toString("hex");
  return `diag_${tsBase36}_${rand}`;
}
