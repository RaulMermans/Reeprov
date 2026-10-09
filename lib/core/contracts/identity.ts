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
  agent_id: z.string().optional(),
  session_id: z.string().optional(),
  external_execution_id: z.string().optional(),
  parent_run_id: z.string().optional(),
  root_run_id: z.string().optional(),
  created_at: z.string(),
});

export type RunIdentity = z.infer<typeof runIdentitySchema>;
