# Agent Configuration Snapshot Architecture

## Overview

AgentPulse captures the **effective execution configuration** that produced an agent run.
Rather than relying on unverified developer declarations or inferring hidden state, AgentPulse records externally observable configuration parameters, scrubs secrets at ingest, and hashes components deterministically.

---

## 1. Structure

```typescript
export interface AgentConfigurationSnapshot {
  snapshot_id: string;
  run_id: string;
  captured_at: string;
  declaration_type: "DECLARED" | "EFFECTIVE" | "HYBRID";

  agent: {
    id: string;
    name?: string;
    version: string;
    implementation_ref?: string;
  };

  model: {
    provider: string;
    model_id: string;
    resolved_revision?: string;
    parameters: Record<string, unknown>;
    parameters_hash: string;
  };

  prompts: Array<{
    id: string;
    version: string;
    content_hash?: string;
  }>;

  skills: Array<{
    id: string;
    version: string;
    source?: string;
    content_hash?: string;
  }>;

  tools: Array<{
    id: string;
    version: string;
    schema_version?: string;
    permission_class?: string;
  }>;

  permissions: {
    policy_id?: string;
    policy_version?: string;
    granted_capabilities: string[];
    denied_capabilities?: string[];
  };

  workflow?: {
    workflow_id?: string;
    workflow_version?: string;
  };

  runtime: {
    framework?: string;
    framework_version?: string;
    language?: string;
    git_sha?: string;
    build_id?: string;
    environment?: string;
  };

  // Component & Root Hashes
  agent_hash: string;
  model_hash: string;
  prompt_set_hash: string;
  skill_set_hash: string;
  tool_set_hash: string;
  permission_policy_hash: string;
  runtime_hash: string;
  config_hash: string;
}
```

---

## 2. Deterministic Canonical Hashing

To ensure that changes between runs can be immediately detected without false positives from array ordering or JSON key sorting:

1. **Set Normalization:**
   - Prompts, skills, and tools are sorted by `id`, then `version`.
   - Permissions arrays are sorted alphabetically and deduplicated.
2. **Canonical JSON Serialization:**
   - Keys in object dictionaries (including model parameters) are recursively sorted prior to hashing.
3. **Component Hashes:**
   - `prompt_set_hash`, `skill_set_hash`, and `tool_set_hash` are invariant to the order in which items were registered.
   - `config_hash` uniquely identifies the compound configuration tuple.

```
Run A config_hash == Run B config_hash
  ⇒ Exact same agent, model, prompts, skills, tools, permissions, and runtime
```

---

## 3. Secret Scrubbing at Boundary

No API keys, access tokens, or private secrets may leak into configuration snapshots.
The snapshot builder automatically sanitizes:
- OpenAI, Anthropic, GitHub, AWS, and generic authorization tokens.
- Secret substrings in model parameters, implementation references, and environment strings.
- Values containing `Bearer`, `sk-`, `ghp_`, or standard entropy patterns.

Redacted values are replaced with `[REDACTED_SECRET]`.

---

## 4. Declared vs. Effective Configuration

AgentPulse marks snapshots explicitly:
- **`DECLARED`:** Configuration specified in source files or static deployment manifests.
- **`EFFECTIVE`:** Configuration resolved at runtime (e.g., fallback model revisions, dynamically filtered tool sets exposed to a specific step).
- **`HYBRID`:** Declared base with observed runtime overrides.

AgentPulse records what was externally observable and never hallucinates runtime state. Missing information is explicitly marked `NOT_DECLARED` or `NOT_CAPTURED`.

---

## 5. Fork Lineage & Configuration Mutation

When an agent run is forked from a checkpoint using `ForkRuntime`:
1. The child run inherits the parent's `configuration_snapshot` as its baseline.
2. Explicit mutations applied to the fork (e.g., prompt version upgrade, model override, tool exposure restriction) update the child's snapshot.
3. The child's component hashes and root `config_hash` are recomputed.
4. The parent artifact remains completely immutable.
5. The relationship between parent and child configuration can be precisely analyzed using `diffConfiguration()` or `pulse config-diff`.
