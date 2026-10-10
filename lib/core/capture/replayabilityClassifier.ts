/**
 * Evidence-Based Replayability Classification.
 *
 * Evaluates whether a boundary's captured evidence is sufficient to safely
 * substitute its recorded output during a future replay run.
 *
 * Core Rule: Replayability is NOT declared merely because an operation completed.
 * It requires captured, non-empty, accessible evidence and verified side-effect safety.
 */

import type { ReplayabilityClass, SideEffectClass, CapturedContentAvailability } from "../contracts/replay";

export interface ReplayabilityEvaluationContext {
  boundaryType: string;
  sideEffectClass: SideEffectClass;
  inputCaptured: boolean;
  outputCaptured: boolean;
  contentAvailability: CapturedContentAvailability;
  isDeterministic?: boolean;
  isSandboxed?: boolean;
  hasError?: boolean;
  requiresLiveConnectivity?: boolean;
  declaredReplayability?: ReplayabilityClass;
}

/**
 * Classifies the replayability of an execution boundary based on observed evidence.
 */
export function classifyReplayability(context: ReplayabilityEvaluationContext): ReplayabilityClass {
  // 1. Explicit declaration from adapter if provided and compatible
  if (context.declaredReplayability && context.declaredReplayability !== "UNKNOWN") {
    // If declared as recorded but output was not captured, downgrade!
    if (
      context.declaredReplayability === "REPLAYABLE_RECORDED" &&
      (!context.outputCaptured || context.contentAvailability === "not_captured" || context.contentAvailability === "NOT_CAPTURED")
    ) {
      return "NON_REPLAYABLE";
    }
    return context.declaredReplayability;
  }

  // 2. Uncaptured output or unavailable payload
  if (!context.outputCaptured || context.contentAvailability === "not_captured" || context.contentAvailability === "NOT_CAPTURED") {
    if (context.requiresLiveConnectivity) {
      return "LIVE_REQUIRED";
    }
    return "NON_REPLAYABLE";
  }

  // 3. Side-effect gates: destructive or external side-effect operations
  // Even if recorded, replaying them could cause real-world changes without approval
  if (context.sideEffectClass === "external_side_effect" || context.sideEffectClass === "destructive") {
    return "SIDE_EFFECT_GATED";
  }

  // 4. Sandboxed environments
  if (context.isSandboxed) {
    return "REPLAYABLE_SANDBOXED";
  }

  // 5. Pure deterministic computation
  if (context.isDeterministic && context.sideEffectClass === "read_only") {
    return "REPLAYABLE_DETERMINISTIC";
  }

  // 6. Read-only or draft-writing boundaries with captured inputs and outputs
  if (
    (context.sideEffectClass === "read_only" || context.sideEffectClass === "write_draft") &&
    context.inputCaptured &&
    context.outputCaptured &&
    (context.contentAvailability === "full" ||
      context.contentAvailability === "CAPTURED" ||
      context.contentAvailability === "REDACTED" ||
      context.contentAvailability === "summary_only")
  ) {
    return "REPLAYABLE_RECORDED";
  }

  // 7. Fallback to UNKNOWN
  return "UNKNOWN";
}
