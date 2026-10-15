export interface VersionCheck {
  component: string;
  expected: string;
  actual: string;
  valid: boolean;
  error?: string;
}

export interface ValidationSummary {
  valid: boolean;
  canonicalSemver: string;
  expectedPep440: string;
  checks: VersionCheck[];
}

export function semverToPep440(semver: string): string;
export function normalizeSemver(v: string): string;
export function validateVersions(options?: {
  rootDir?: string;
  inputVersion?: string;
  gitTag?: string;
}): ValidationSummary;
