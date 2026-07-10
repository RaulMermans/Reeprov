import { redactSecrets } from "@/lib/scanner/redactSecrets";

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 400;

/**
 * Defense-in-depth redaction for diagnostic messages before persistence.
 * Diagnostic messages should already be hand-authored, human-safe strings —
 * this catches the case where an upstream message accidentally embeds a
 * credential-shaped value (e.g. echoed from a malformed request).
 */
export function redactDiagnosticMessage(message: string): string {
  const truncated =
    message.length > MAX_DIAGNOSTIC_MESSAGE_LENGTH
      ? `${message.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH)}…`
      : message;
  return redactSecrets(truncated).content;
}
