import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../../");
const runDetailSource = readFileSync(
  path.join(root, "app/dashboard/runs/[runId]/page.tsx"),
  "utf8",
);

describe("run detail workflow template UI", () => {
  it("renders the resolved template or inferred workflow label in the primary map", () => {
    expect(runDetailSource).toContain('data-testid="workflow-source-label"');
    expect(runDetailSource).toContain("workflowSourceLabel(workflow)");
  });

  it("uses the built-in registry before falling back to inference", () => {
    expect(runDetailSource).toContain("getBuiltInWorkflowSpec(");
    expect(runDetailSource).toContain("buildWorkflowMap(stages, workflow)");
    expect(runDetailSource).toContain("buildInferredWorkflowSummary(stages)");
  });

  it("does not show the old missing-spec warning copy", () => {
    expect(runDetailSource).not.toContain("No registered WorkflowSpec");
    expect(runDetailSource).not.toContain("No workflow spec linked");
  });
});
