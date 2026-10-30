/**
 * Evaluator-only held-out and sealed-evaluation access control.
 *
 * Detector-role workspaces and the development CLI must not load private
 * labels. Genuine blindness for the in-tree 16 held-out cases cannot be
 * established: those answers were published in PR #27 / commit 3912ffe.
 * Independently sealed packs are the practical mechanism for new cases.
 */

export const HELDOUT_ALLOW_ENV = "REEPROV_P3_ALLOW_HELDOUT";
export const DETECTOR_ROLE_ENV = "REEPROV_P3_DETECTOR_ROLE";
export const SEALED_EVAL_ENV = "REEPROV_P3_SEALED_EVALUATION_PATH";

export class HeldOutAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeldOutAccessError";
  }
}

export function detectorRoleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DETECTOR_ROLE_ENV] === "1";
}

export function heldOutScoringAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[HELDOUT_ALLOW_ENV] === "1";
}

export function assertCanLoadHeldOutOracles(
  reason: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (detectorRoleEnabled(env)) {
    throw new HeldOutAccessError(
      `Detector-role workspace cannot load held-out oracles (${reason}). Unset ${DETECTOR_ROLE_ENV}.`
    );
  }
  if (!heldOutScoringAllowed(env)) {
    throw new HeldOutAccessError(
      `Held-out oracle scoring is gated (${reason}). Evaluator operators set ${HELDOUT_ALLOW_ENV}=1. ` +
        `H1 detector workspaces must not. Independently sealed cases load via ${SEALED_EVAL_ENV}. ` +
        `In-tree held-out labels were published in p3.benchmark.v1 and are not blind.`
    );
  }
}
