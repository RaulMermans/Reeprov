# Workflow Spec

A `WorkflowSpec` is a declarative description of what an AI workflow does. It is the structural contract AgentPulse uses to validate trace events and generate run summaries.

Task 2 uses workflow specs as dashboard proof data. Specs power the workflow gallery, workflow inspector, node detail panels, edge/dependency rows, declared tools, eval references, permission badges, approval gates, and artifact lists.

## Node Types

| type | Description |
|---|---|
| `trigger` | Entry point. Defines what starts the workflow (schedule, webhook, manual). |
| `llm` | A direct model call node that does not have agent loop behavior. |
| `agent` | A model-powered node with tool access and loop behavior. |
| `tool` | An external tool invocation (web search, API call, file read, etc.). |
| `evaluator` | An evaluation node that checks output quality, safety, or schema. |
| `approval` | A human-in-the-loop gate. Required when destructive or external_side_effect nodes are present. |
| `artifact` | Produces a final output artifact (markdown file, JSON report, etc.). |
| `router` | A conditional branching node. |
| `retrieval` | A retrieval-augmented generation step (vector search, document lookup). |
| `deterministic` | A non-model step with deterministic logic (scoring, filtering, formatting). |

## Node Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique node identifier within the workflow. |
| `type` | string | yes | One of the node types listed above. |
| `label` | string | yes | Human-readable name for the node. |
| `description` | string | no | What this node does. |
| `model_provider` | string | no | Provider name (e.g. "anthropic", "openai"). |
| `model_name` | string | no | Model name (e.g. "claude-3-5-haiku-20241022"). |
| `allowed_tools` | string[] | no | Tools this node is allowed to invoke. |
| `input_schema_ref` | string | no | Reference to an input schema definition. |
| `output_schema_ref` | string | no | Reference to an output schema definition. |
| `eval_refs` | string[] | no | Eval IDs that should run after this node. |
| `permission_class` | string | no | Permission class for the actions this node takes. |
| `timeout_ms` | number | no | Maximum allowed duration for this node in milliseconds. |
| `max_retries` | number | no | Maximum number of retries before the node fails. |

## permission_class Values

| Value | Meaning |
|---|---|
| `read_only` | Node only reads data. No side effects. |
| `write_draft` | Node writes to a draft or private buffer. Does not publish. |
| `external_side_effect` | Node calls an external service (email, API write, webhook). Requires approval node in workflow. |
| `destructive` | Node deletes or irreversibly modifies data. Requires approval node in workflow. |
| `sensitive_data` | Node handles personally identifiable or sensitive information. |

## architecture_type Values

| Value | Description |
|---|---|
| `single_llm_call` | One model call with no looping or tool use. |
| `rag` | Retrieval-augmented generation: retrieve then generate. |
| `prompt_chain` | Sequential chain of model calls, each feeding the next. |
| `deterministic_workflow` | Structured pipeline with fixed steps. May include model calls. |
| `workflow_tools` | Workflow that uses tools but no persistent agent loop. |
| `single_agent` | One agent with tool access and loop behavior. |
| `hybrid_workflow_agent` | Mix of deterministic workflow steps and agent nodes. |
| `multi_agent` | Multiple cooperating agents with handoffs between them. |

## Edges

Edges connect nodes in order. An edge has a `from` node ID and a `to` node ID. An optional `condition` string describes when the edge is followed (for router nodes).

All edge `from` and `to` values must reference node IDs that exist in the `nodes` array. Invalid edge references cause schema validation to fail.

## Validation Rules

1. All `edge.from` and `edge.to` values must be present in `nodes`.
2. Any workflow with a `destructive` or `external_side_effect` node must include at least one `approval` node.

## Read-Only Dashboard Architecture

The dashboard reads local examples only:

- Workflow specs from `examples/workflows`.
- Trace events from `examples/traces`.
- Eval results from `examples/evals`.
- Run records from `examples/runs`.

`lib/proof-layer/examples.ts` validates those files and exposes `getExampleWorkflows()`, `getExampleRuns()`, `getExampleTraceEvents(runId)`, `getExampleEvalResults(runId)`, `getWorkflowById(workflowId)`, and `getRunById(runId)`.

The dashboard intentionally does not execute workflows, execute scanned repositories, call external APIs, add a database, modify authentication, or act as a no-code builder.

## Next Planned Task

The next planned task is real project integration through local trace ingestion. Connected projects should emit AgentPulse-compatible traces that can be loaded from local files or a local ingestion boundary before any hosted runtime exists.

## Example: Website Auditor Workflow Snippet

```json
{
  "workflow_id": "website-auditor-v1",
  "name": "Website Auditor",
  "version": "1.0.0",
  "description": "Crawls a website and produces a brand, UX, and SEO audit report.",
  "architecture_type": "deterministic_workflow",
  "nodes": [
    { "id": "trigger", "type": "trigger", "label": "Audit Trigger" },
    { "id": "crawl", "type": "tool", "label": "Web Crawler", "permission_class": "read_only" },
    { "id": "brand-audit-agent", "type": "agent", "label": "Brand Audit Agent",
      "model_provider": "anthropic", "model_name": "claude-3-5-sonnet-20241022" },
    { "id": "ux-audit-agent", "type": "agent", "label": "UX Audit Agent",
      "model_provider": "anthropic", "model_name": "claude-3-5-sonnet-20241022" },
    { "id": "seo-audit-agent", "type": "agent", "label": "SEO Audit Agent",
      "model_provider": "anthropic", "model_name": "claude-3-5-haiku-20241022" },
    { "id": "evidence-evaluator", "type": "evaluator", "label": "Evidence Evaluator",
      "eval_refs": ["source_grounding", "schema_validity"] },
    { "id": "report-synthesizer", "type": "llm", "label": "Report Synthesizer",
      "model_provider": "anthropic", "model_name": "claude-3-5-sonnet-20241022" },
    { "id": "final-audit-artifact", "type": "artifact", "label": "Final Audit Report" }
  ],
  "edges": [
    { "from": "trigger", "to": "crawl" },
    { "from": "crawl", "to": "brand-audit-agent" },
    { "from": "crawl", "to": "ux-audit-agent" },
    { "from": "crawl", "to": "seo-audit-agent" },
    { "from": "brand-audit-agent", "to": "evidence-evaluator" },
    { "from": "ux-audit-agent", "to": "evidence-evaluator" },
    { "from": "seo-audit-agent", "to": "evidence-evaluator" },
    { "from": "evidence-evaluator", "to": "report-synthesizer" },
    { "from": "report-synthesizer", "to": "final-audit-artifact" }
  ]
}
```
