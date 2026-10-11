/**
 * Agent Configuration Snapshot Contracts & Deterministic Hashing.
 *
 * Captures the externally observable agent configuration that produced a run:
 * agent identity, model, prompts, skills, tools, permissions, workflow, and runtime.
 *
 * Distinguishes DECLARED vs EFFECTIVE configuration and computes canonical,
 * permutation-invariant component hashes and overall config_hash.
 */

import { z } from "zod";
import { hashPayload, canonicalJsonStringify } from "../capture/hashing";
import { sanitizePayload } from "../capture/redaction";

// ── Agent Identity Config ───────────────────────────────────────────────────

export const agentIdentityConfigSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  version: z.string(),
  implementation_ref: z.string().optional(),
});

export type AgentIdentityConfig = z.infer<typeof agentIdentityConfigSchema>;

// ── Model Config ────────────────────────────────────────────────────────────

export const modelConfigSchema = z.object({
  provider: z.string(),
  model_id: z.string(),
  resolved_revision: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  parameters_hash: z.string().optional(),
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;

// ── Prompt Config ───────────────────────────────────────────────────────────

export const promptConfigSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string().optional(),
  source: z.string().optional(),
  content_hash: z.string().optional(),
});

export type PromptConfig = z.infer<typeof promptConfigSchema>;

// ── Skill Config ────────────────────────────────────────────────────────────

export const skillConfigSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string().optional(),
  source: z.string().optional(),
  content_hash: z.string().optional(),
});

export type SkillConfig = z.infer<typeof skillConfigSchema>;

// ── Tool Config ─────────────────────────────────────────────────────────────

export const toolConfigSchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string().optional(),
  schema_version: z.string().optional(),
  permission_class: z.string().optional(),
});

export type ToolConfig = z.infer<typeof toolConfigSchema>;

// ── Permissions Policy Config ───────────────────────────────────────────────

export const permissionPolicyConfigSchema = z.object({
  policy_id: z.string().optional(),
  policy_version: z.string().optional(),
  granted_capabilities: z.array(z.string()).default([]),
  denied_capabilities: z.array(z.string()).optional(),
});

export type PermissionPolicyConfig = z.infer<typeof permissionPolicyConfigSchema>;

// ── Workflow Config ─────────────────────────────────────────────────────────

export const workflowConfigSchema = z.object({
  workflow_id: z.string().optional(),
  workflow_version: z.string().optional(),
});

export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

// ── Runtime Config ──────────────────────────────────────────────────────────

export const runtimeConfigSchema = z.object({
  framework: z.string().optional(),
  framework_version: z.string().optional(),
  language_runtime: z.string().optional(),
  git_sha: z.string().optional(),
  build_id: z.string().optional(),
  environment: z.string().optional(),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

// ── Canonical Agent Configuration Snapshot ──────────────────────────────────

export const agentConfigurationSnapshotSchema = z.object({
  snapshot_id: z.string(),
  run_id: z.string(),
  captured_at: z.string(),
  declaration_type: z.enum(["DECLARED", "EFFECTIVE"]).default("EFFECTIVE"),
  agent: agentIdentityConfigSchema,
  model: modelConfigSchema,
  prompts: z.array(promptConfigSchema).default([]),
  skills: z.array(skillConfigSchema).default([]),
  tools: z.array(toolConfigSchema).default([]),
  permissions: permissionPolicyConfigSchema.default({ granted_capabilities: [] }),
  workflow: workflowConfigSchema.optional(),
  runtime: runtimeConfigSchema.optional(),

  // Hashes
  agent_hash: z.string().optional(),
  model_hash: z.string().optional(),
  prompt_set_hash: z.string().optional(),
  skill_set_hash: z.string().optional(),
  tool_set_hash: z.string().optional(),
  permission_policy_hash: z.string().optional(),
  runtime_hash: z.string().optional(),
  config_hash: z.string(),
});

export type AgentConfigurationSnapshot = z.infer<typeof agentConfigurationSnapshotSchema>;

// ── Deterministic Sorting & Normalization ───────────────────────────────────

/**
 * Normalizes sets within configuration to ensure permutation invariance.
 * Unordered collections like tools, skills, prompts, and capability lists
 * are deterministically sorted.
 */
export function normalizeConfigurationSets<T extends {
  prompts?: PromptConfig[];
  skills?: SkillConfig[];
  tools?: ToolConfig[];
  permissions?: PermissionPolicyConfig;
}>(config: T): T {
  const cloned = { ...config };

  if (cloned.prompts) {
    cloned.prompts = [...cloned.prompts].sort((a, b) =>
      a.id.localeCompare(b.id) || a.version.localeCompare(b.version)
    );
  }

  if (cloned.skills) {
    cloned.skills = [...cloned.skills].sort((a, b) =>
      a.id.localeCompare(b.id) || a.version.localeCompare(b.version)
    );
  }

  if (cloned.tools) {
    cloned.tools = [...cloned.tools].sort((a, b) =>
      a.id.localeCompare(b.id) || a.version.localeCompare(b.version)
    );
  }

  if (cloned.permissions) {
    cloned.permissions = {
      ...cloned.permissions,
      granted_capabilities: [...(cloned.permissions.granted_capabilities ?? [])].sort(),
      denied_capabilities: cloned.permissions.denied_capabilities
        ? [...cloned.permissions.denied_capabilities].sort()
        : undefined,
    };
  }

  return cloned;
}

// ── Secret Sanitization ─────────────────────────────────────────────────────

/**
 * Scrubs any secret values (API keys, tokens, passwords) from configuration data.
 */
export function sanitizeConfigurationInput<T extends Record<string, unknown>>(input: T): T {
  const sanitized = sanitizePayload(input);
  return sanitized.value;
}

// ── Component & Overall Hash Computation ────────────────────────────────────

export interface ComponentHashes {
  agent_hash: string;
  model_hash: string;
  prompt_set_hash: string;
  skill_set_hash: string;
  tool_set_hash: string;
  permission_policy_hash: string;
  runtime_hash: string;
  config_hash: string;
}

export function computeConfigurationHashes(
  snapshot: Omit<AgentConfigurationSnapshot, "config_hash" | "agent_hash" | "model_hash" | "prompt_set_hash" | "skill_set_hash" | "tool_set_hash" | "permission_policy_hash" | "runtime_hash">
): ComponentHashes {
  const normalized = normalizeConfigurationSets(snapshot);

  const agent_hash = hashPayload({
    id: normalized.agent.id,
    version: normalized.agent.version,
    name: normalized.agent.name ?? null,
    implementation_ref: normalized.agent.implementation_ref ?? null,
  });

  const model_hash = hashPayload({
    provider: normalized.model.provider,
    model_id: normalized.model.model_id,
    resolved_revision: normalized.model.resolved_revision ?? null,
    parameters: normalized.model.parameters ?? {},
  });

  const prompt_set_hash = hashPayload(
    (normalized.prompts ?? []).map((p) => ({
      id: p.id,
      version: p.version,
      content_hash: p.content_hash ?? null,
    }))
  );

  const skill_set_hash = hashPayload(
    (normalized.skills ?? []).map((s) => ({
      id: s.id,
      version: s.version,
      content_hash: s.content_hash ?? null,
    }))
  );

  const tool_set_hash = hashPayload(
    (normalized.tools ?? []).map((t) => ({
      id: t.id,
      version: t.version,
      schema_version: t.schema_version ?? null,
      permission_class: t.permission_class ?? null,
    }))
  );

  const permission_policy_hash = hashPayload({
    policy_id: normalized.permissions?.policy_id ?? null,
    policy_version: normalized.permissions?.policy_version ?? null,
    granted_capabilities: normalized.permissions?.granted_capabilities ?? [],
    denied_capabilities: normalized.permissions?.denied_capabilities ?? [],
  });

  const runtime_hash = hashPayload({
    framework: normalized.runtime?.framework ?? null,
    framework_version: normalized.runtime?.framework_version ?? null,
    language_runtime: normalized.runtime?.language_runtime ?? null,
    git_sha: normalized.runtime?.git_sha ?? null,
    build_id: normalized.runtime?.build_id ?? null,
    environment: normalized.runtime?.environment ?? null,
  });

  // Canonical config_hash incorporates all component hashes and workflow version
  const config_hash = hashPayload({
    agent_hash,
    model_hash,
    prompt_set_hash,
    skill_set_hash,
    tool_set_hash,
    permission_policy_hash,
    runtime_hash,
    workflow: normalized.workflow ?? null,
  });

  return {
    agent_hash,
    model_hash,
    prompt_set_hash,
    skill_set_hash,
    tool_set_hash,
    permission_policy_hash,
    runtime_hash,
    config_hash,
  };
}

// ── Snapshot Factory ────────────────────────────────────────────────────────

export type AgentConfigurationInput = {
  snapshot_id?: string;
  run_id: string;
  captured_at?: string;
  declaration_type?: "DECLARED" | "EFFECTIVE";
  agent: AgentIdentityConfig;
  model: ModelConfig;
  prompts?: PromptConfig[];
  skills?: SkillConfig[];
  tools?: ToolConfig[];
  permissions?: PermissionPolicyConfig;
  workflow?: WorkflowConfig;
  runtime?: RuntimeConfig;
};

export function buildAgentConfigurationSnapshot(
  input: AgentConfigurationInput
): AgentConfigurationSnapshot {
  // 1. Sanitize secrets
  const sanitized = sanitizeConfigurationInput(input as Record<string, unknown>) as unknown as AgentConfigurationInput;

  // 2. Normalize collections
  const normalized = normalizeConfigurationSets(sanitized);

  // 3. Compute hashes
  const hashes = computeConfigurationHashes({
    snapshot_id: normalized.snapshot_id ?? "temp",
    run_id: normalized.run_id,
    captured_at: normalized.captured_at ?? new Date().toISOString(),
    declaration_type: normalized.declaration_type ?? "EFFECTIVE",
    agent: normalized.agent,
    model: {
      ...normalized.model,
      parameters_hash: normalized.model.parameters_hash ?? hashPayload(normalized.model.parameters ?? {}),
    },
    prompts: normalized.prompts ?? [],
    skills: normalized.skills ?? [],
    tools: normalized.tools ?? [],
    permissions: normalized.permissions ?? { granted_capabilities: [] },
    workflow: normalized.workflow,
    runtime: normalized.runtime,
  });

  const snapshotId = normalized.snapshot_id ?? `cfg_${normalized.run_id}_${hashes.config_hash.slice(7, 19)}`;

  return agentConfigurationSnapshotSchema.parse({
    snapshot_id: snapshotId,
    run_id: normalized.run_id,
    captured_at: normalized.captured_at ?? new Date().toISOString(),
    declaration_type: normalized.declaration_type ?? "EFFECTIVE",
    agent: normalized.agent,
    model: {
      ...normalized.model,
      parameters_hash: normalized.model.parameters_hash ?? hashPayload(normalized.model.parameters ?? {}),
    },
    prompts: normalized.prompts ?? [],
    skills: normalized.skills ?? [],
    tools: normalized.tools ?? [],
    permissions: normalized.permissions ?? { granted_capabilities: [] },
    workflow: normalized.workflow,
    runtime: normalized.runtime,
    ...hashes,
  });
}

// ── Deterministic Structural Configuration Diff ─────────────────────────────

export interface ConfigurationDiff {
  identical: boolean;
  changed_agent: boolean;
  changed_model: boolean;
  changed_parameters: boolean;
  changed_prompts: boolean;
  changed_skills: boolean;
  changed_tools: boolean;
  changed_permissions: boolean;
  changed_workflow: boolean;
  changed_runtime_config: boolean;
  differences: {
    agent?: { before: AgentIdentityConfig; after: AgentIdentityConfig };
    model?: { before: ModelConfig; after: ModelConfig };
    parameters?: { before: Record<string, unknown>; after: Record<string, unknown> };
    prompts?: {
      added: PromptConfig[];
      removed: PromptConfig[];
      modified: Array<{ id: string; before: PromptConfig; after: PromptConfig }>;
    };
    skills?: {
      added: SkillConfig[];
      removed: SkillConfig[];
      modified: Array<{ id: string; before: SkillConfig; after: SkillConfig }>;
    };
    tools?: {
      added: ToolConfig[];
      removed: ToolConfig[];
      modified: Array<{ id: string; before: ToolConfig; after: ToolConfig }>;
    };
    permissions?: { before: PermissionPolicyConfig; after: PermissionPolicyConfig };
    workflow?: { before?: WorkflowConfig; after?: WorkflowConfig };
    runtime?: { before?: RuntimeConfig; after?: RuntimeConfig };
  };
  summary: string[];
}

export function diffConfiguration(
  before: AgentConfigurationSnapshot,
  after: AgentConfigurationSnapshot
): ConfigurationDiff {
  const normBefore = normalizeConfigurationSets(before);
  const normAfter = normalizeConfigurationSets(after);

  const hashesBefore = computeConfigurationHashes(normBefore);
  const hashesAfter = computeConfigurationHashes(normAfter);

  const changed_agent = hashesBefore.agent_hash !== hashesAfter.agent_hash;
  const changed_model =
    normBefore.model.provider !== normAfter.model.provider ||
    normBefore.model.model_id !== normAfter.model.model_id ||
    normBefore.model.resolved_revision !== normAfter.model.resolved_revision;
  const changed_parameters =
    canonicalJsonStringify(normBefore.model.parameters) !==
    canonicalJsonStringify(normAfter.model.parameters);
  const changed_prompts = hashesBefore.prompt_set_hash !== hashesAfter.prompt_set_hash;
  const changed_skills = hashesBefore.skill_set_hash !== hashesAfter.skill_set_hash;
  const changed_tools = hashesBefore.tool_set_hash !== hashesAfter.tool_set_hash;
  const changed_permissions = hashesBefore.permission_policy_hash !== hashesAfter.permission_policy_hash;
  const changed_workflow =
    canonicalJsonStringify(normBefore.workflow) !== canonicalJsonStringify(normAfter.workflow);
  const changed_runtime_config = hashesBefore.runtime_hash !== hashesAfter.runtime_hash;

  const identical = hashesBefore.config_hash === hashesAfter.config_hash;

  const summary: string[] = [];
  const differences: ConfigurationDiff["differences"] = {};

  if (changed_agent) {
    differences.agent = { before: normBefore.agent, after: normAfter.agent };
    summary.push(
      `agent: ${normBefore.agent.id}@${normBefore.agent.version} → ${normAfter.agent.id}@${normAfter.agent.version}`
    );
  }

  if (changed_model) {
    differences.model = { before: normBefore.model, after: normAfter.model };
    summary.push(
      `model: ${normBefore.model.provider}/${normBefore.model.model_id} → ${normAfter.model.provider}/${normAfter.model.model_id}`
    );
  }

  if (changed_parameters) {
    differences.parameters = { before: normBefore.model.parameters, after: normAfter.model.parameters };
    summary.push(`model parameters modified`);
  }

  if (changed_prompts) {
    const beforeMap = new Map((normBefore.prompts ?? []).map((p) => [p.id, p]));
    const afterMap = new Map((normAfter.prompts ?? []).map((p) => [p.id, p]));

    const added: PromptConfig[] = [];
    const removed: PromptConfig[] = [];
    const modified: Array<{ id: string; before: PromptConfig; after: PromptConfig }> = [];

    for (const [id, a] of afterMap.entries()) {
      const b = beforeMap.get(id);
      if (!b) {
        added.push(a);
        summary.push(`prompt added: ${id}@${a.version}`);
      } else if (canonicalJsonStringify(b) !== canonicalJsonStringify(a)) {
        modified.push({ id, before: b, after: a });
        summary.push(`prompt modified: ${id} (${b.version} → ${a.version})`);
      }
    }
    for (const [id, b] of beforeMap.entries()) {
      if (!afterMap.has(id)) {
        removed.push(b);
        summary.push(`prompt removed: ${id}@${b.version}`);
      }
    }
    differences.prompts = { added, removed, modified };
  }

  if (changed_skills) {
    const beforeMap = new Map((normBefore.skills ?? []).map((s) => [s.id, s]));
    const afterMap = new Map((normAfter.skills ?? []).map((s) => [s.id, s]));

    const added: SkillConfig[] = [];
    const removed: SkillConfig[] = [];
    const modified: Array<{ id: string; before: SkillConfig; after: SkillConfig }> = [];

    for (const [id, a] of afterMap.entries()) {
      const b = beforeMap.get(id);
      if (!b) {
        added.push(a);
        summary.push(`skill added: ${id}@${a.version}`);
      } else if (canonicalJsonStringify(b) !== canonicalJsonStringify(a)) {
        modified.push({ id, before: b, after: a });
        summary.push(`skill modified: ${id} (${b.version} → ${a.version})`);
      }
    }
    for (const [id, b] of beforeMap.entries()) {
      if (!afterMap.has(id)) {
        removed.push(b);
        summary.push(`skill removed: ${id}@${b.version}`);
      }
    }
    differences.skills = { added, removed, modified };
  }

  if (changed_tools) {
    const beforeMap = new Map((normBefore.tools ?? []).map((t) => [t.id, t]));
    const afterMap = new Map((normAfter.tools ?? []).map((t) => [t.id, t]));

    const added: ToolConfig[] = [];
    const removed: ToolConfig[] = [];
    const modified: Array<{ id: string; before: ToolConfig; after: ToolConfig }> = [];

    for (const [id, a] of afterMap.entries()) {
      const b = beforeMap.get(id);
      if (!b) {
        added.push(a);
        summary.push(`tool added: ${id}@${a.version}`);
      } else if (canonicalJsonStringify(b) !== canonicalJsonStringify(a)) {
        modified.push({ id, before: b, after: a });
        summary.push(`tool modified: ${id} (${b.version} → ${a.version})`);
      }
    }
    for (const [id, b] of beforeMap.entries()) {
      if (!afterMap.has(id)) {
        removed.push(b);
        summary.push(`tool removed: ${id}@${b.version}`);
      }
    }
    differences.tools = { added, removed, modified };
  }

  if (changed_permissions) {
    differences.permissions = { before: normBefore.permissions, after: normAfter.permissions };
    summary.push(`permissions policy modified`);
  }

  if (changed_workflow) {
    differences.workflow = { before: normBefore.workflow, after: normAfter.workflow };
    summary.push(`workflow modified`);
  }

  if (changed_runtime_config) {
    differences.runtime = { before: normBefore.runtime, after: normAfter.runtime };
    summary.push(`runtime configuration modified`);
  }

  return {
    identical,
    changed_agent,
    changed_model,
    changed_parameters,
    changed_prompts,
    changed_skills,
    changed_tools,
    changed_permissions,
    changed_workflow,
    changed_runtime_config,
    differences,
    summary,
  };
}
