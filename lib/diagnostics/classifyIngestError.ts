import type { IngestDiagnosticCategory } from "./diagnosticTypes";

export interface ClassifiedIssue {
  category: IngestDiagnosticCategory;
  schemaPath?: string;
}

interface PathIssue {
  path: PropertyKey[];
}

/**
 * Classifies a set of zod validation issues into the most specific ingest
 * diagnostic category, based on which field the first issue points at.
 * Falls back to a generic "schema_validation_failed" category.
 */
export function classifyZodIssues(issues: PathIssue[]): ClassifiedIssue {
  const first = issues[0];
  const schemaPath = first ? first.path.join(".") : undefined;

  if (issues.some((issue) => issue.path.includes("event_type"))) {
    return { category: "unknown_event_type", schemaPath };
  }
  if (issues.some((issue) => issue.path.includes("run_id"))) {
    return { category: "missing_run_id", schemaPath };
  }
  if (issues.some((issue) => issue.path.includes("project_id"))) {
    return { category: "missing_project_id", schemaPath };
  }
  if (issues.some((issue) => issue.path.includes("timestamp"))) {
    return { category: "timestamp_parse_error", schemaPath };
  }
  return { category: "schema_validation_failed", schemaPath };
}
