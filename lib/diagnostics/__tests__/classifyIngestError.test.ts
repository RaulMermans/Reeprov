import { describe, expect, it } from "vitest";
import { classifyZodIssues } from "@/lib/diagnostics/classifyIngestError";

describe("classifyZodIssues", () => {
  it("classifies event_type issues as unknown_event_type", () => {
    const result = classifyZodIssues([{ path: ["event_type"] }]);
    expect(result.category).toBe("unknown_event_type");
    expect(result.schemaPath).toBe("event_type");
  });

  it("classifies run_id issues as missing_run_id", () => {
    const result = classifyZodIssues([{ path: ["run_id"] }]);
    expect(result.category).toBe("missing_run_id");
  });

  it("classifies project_id issues as missing_project_id", () => {
    const result = classifyZodIssues([{ path: ["project_id"] }]);
    expect(result.category).toBe("missing_project_id");
  });

  it("classifies timestamp issues as timestamp_parse_error", () => {
    const result = classifyZodIssues([{ path: ["timestamp"] }]);
    expect(result.category).toBe("timestamp_parse_error");
  });

  it("falls back to schema_validation_failed for unrecognized fields", () => {
    const result = classifyZodIssues([{ path: ["metadata", "nested_field"] }]);
    expect(result.category).toBe("schema_validation_failed");
  });

  it("handles an empty issues array without throwing", () => {
    const result = classifyZodIssues([]);
    expect(result.category).toBe("schema_validation_failed");
    expect(result.schemaPath).toBeUndefined();
  });
});
