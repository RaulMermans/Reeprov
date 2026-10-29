/**
 * Canonical Run Identity Contracts.
 *
 * Provides immutable identification and cross-system correlation for an agent execution.
 */

import { z } from "zod";

export const runIdentitySchema = z.object({
  run_id: z.string(),
  project_id: z.string(),
  project_name: z.string().optional(),
  workflow_id: z.string(),
  workflow_version: z.string().optional(),
  /** Initiating or primary agent when known. Omitted when attribution is unknown. */
  agent_id: z.string().optional(),
  /**
   * Distinct agent identities observed on this run. Empty/omitted means
   * participating agents were not established — never invented.
   */
  participating_agent_ids: z.array(z.string()).optional(),
  session_id: z.string().optional(),
  external_execution_id: z.string().optional(),
  parent_run_id: z.string().optional(),
  root_run_id: z.string().optional(),
  created_at: z.string(),
});

export type RunIdentity = z.infer<typeof runIdentitySchema>;

/** Labels that describe a role, not a specific agent identity. */
const NON_IDENTITY_AGENT_LABELS = new Set([
  "agent",
  "actor",
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
]);

/**
 * Promote only explicit agent identifiers. Generic labels such as "agent" or
 * "actor" stay in metadata so uncertain attribution is not silently resolved.
 */
export function resolveExplicitAgentId(
  ...candidates: Array<string | undefined | null>
): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) continue;
    if (NON_IDENTITY_AGENT_LABELS.has(trimmed.toLowerCase())) continue;
    return trimmed;
  }
  return undefined;
}

export function agentIdFromMetadata(
  metadata?: Record<string, unknown> | null
): string | undefined {
  if (!metadata) return undefined;
  const direct = metadata["agent_id"] ?? metadata["agentId"];
  return typeof direct === "string" ? resolveExplicitAgentId(direct) : undefined;
}

export function uniqueAgentIds(
  ...groups: Array<Iterable<string | undefined> | undefined>
): string[] {
  const seen = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    for (const value of group) {
      const id = resolveExplicitAgentId(value);
      if (id) seen.add(id);
    }
  }
  return [...seen];
}
