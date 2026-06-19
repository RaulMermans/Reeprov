import { describe, expect, it } from "vitest";
import { workflowSpecSchema } from "@/lib/proof-layer/schemas";
import {
  BLOG_AGENT_STAGE_ORDER,
  BLOG_AGENT_WORKFLOW_SPEC,
  getBuiltInWorkflowSpec,
  listBuiltInWorkflowSpecs,
} from "@/lib/workflows/builtInWorkflowSpecs";

describe("built-in WorkflowSpec registry", () => {
  it("registers a valid BlogAgent v1 workflow template", () => {
    expect(workflowSpecSchema.safeParse(BLOG_AGENT_WORKFLOW_SPEC).success).toBe(true);
    expect(getBuiltInWorkflowSpec("blog-agent", "blog-agent-v1")).toBe(BLOG_AGENT_WORKFLOW_SPEC);
    expect(listBuiltInWorkflowSpecs()).toContain(BLOG_AGENT_WORKFLOW_SPEC);
  });

  it("keeps the canonical ten-stage order stable", () => {
    expect(BLOG_AGENT_WORKFLOW_SPEC.expected_order).toEqual(BLOG_AGENT_STAGE_ORDER);
    expect(BLOG_AGENT_WORKFLOW_SPEC.nodes.map((node) => node.id)).toEqual(BLOG_AGENT_STAGE_ORDER);
    expect(BLOG_AGENT_STAGE_ORDER).toHaveLength(10);
  });

  it("includes first-class stage metadata and workflow gates", () => {
    expect(BLOG_AGENT_WORKFLOW_SPEC.project_id).toBe("blog-agent");
    expect(BLOG_AGENT_WORKFLOW_SPEC.nodes.every((node) => node.stage_category)).toBe(true);
    expect(BLOG_AGENT_WORKFLOW_SPEC.nodes.every((node) => node.expected_inputs?.length)).toBe(true);
    expect(BLOG_AGENT_WORKFLOW_SPEC.nodes.every((node) => node.expected_outputs?.length)).toBe(true);
    expect(BLOG_AGENT_WORKFLOW_SPEC.risk_gates?.length).toBeGreaterThan(0);
    expect(BLOG_AGENT_WORKFLOW_SPEC.quality_gates?.length).toBeGreaterThan(0);
  });
});
