/**
 * Reeprov Environment Variable Resolution & Migration Fallbacks.
 *
 * Enforces canonical REEPROV_* environment variables while preserving
 * bounded legacy compatibility with AGENTPULSE_* variables during the
 * migration window.
 *
 * Rules:
 *   - REEPROV_* present: use canonical value.
 *   - Else AGENTPULSE_* present: accept legacy value, emit bounded warning.
 *   - Never log secret values.
 */

const warnedVariables = new Set<string>();

/**
 * Reset tracked deprecation warnings (primarily for unit tests).
 */
export function resetEnvDeprecationWarnings(): void {
  warnedVariables.clear();
}

/**
 * Returns whether a deprecation warning was emitted for a given legacy variable.
 */
export function hasWarnedForEnv(legacyKey: string): boolean {
  return warnedVariables.has(legacyKey);
}

/**
 * Resolves an environment variable using canonical REEPROV_* name with AGENTPULSE_* fallback.
 *
 * @param canonicalKey - The canonical variable name, e.g. "REEPROV_MODE" or "REEPROV_INGEST_KEY".
 * @param legacyKeyOverride - Optional legacy key name if not standard string replacement.
 */
export function getReeprovEnv(
  canonicalKey: string,
  legacyKeyOverride?: string
): string | undefined {
  const canonicalVal = process.env[canonicalKey];
  if (canonicalVal !== undefined && canonicalVal !== "") {
    return canonicalVal;
  }

  const legacyKey =
    legacyKeyOverride || canonicalKey.replace(/^REEPROV_/, "AGENTPULSE_");
  const legacyVal = process.env[legacyKey];

  if (legacyVal !== undefined && legacyVal !== "") {
    if (!warnedVariables.has(legacyKey)) {
      warnedVariables.add(legacyKey);
      // Bounded warning: only emit once per key, never log the secret value itself
      if (process.env.NODE_ENV !== "test" || process.env.REEPROV_TEST_WARN) {
        console.warn(
          `[Reeprov Deprecation Warning] Environment variable '${legacyKey}' is deprecated and will be removed in a future release. Please migrate to '${canonicalKey}'.`
        );
      }
    }
    return legacyVal;
  }

  return undefined;
}
