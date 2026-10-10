/**
 * Boundary Classification & Dependency Identification.
 *
 * Normalizes boundary types and standardizes provider/dependency identifiers.
 */

import type { BoundaryType } from "../contracts/replay";

/**
 * Normalizes various raw boundary type strings into the canonical BoundaryType enum.
 */
export function normalizeBoundaryType(rawType: string): BoundaryType {
  const norm = rawType.toLowerCase().trim();
  switch (norm) {
    case "model_call":
    case "model":
    case "llm":
    case "chat":
    case "completion":
      return "model_call";

    case "tool_call":
    case "tool":
    case "function_call":
      return "tool_call";

    case "retrieval":
    case "retrieval_service":
    case "retrieval_call":
    case "rag":
    case "vector_search":
      return "retrieval_service";

    case "memory_read":
      return "memory_read";

    case "memory_write":
      return "memory_write";

    case "memory":
    case "memory_service":
    case "memory_op":
      return "memory_service";

    case "http":
    case "external_http":
    case "fetch":
    case "api_call":
      return "external_http";

    case "code_execution":
    case "sandbox":
    case "python_exec":
      return "code_execution";

    case "filesystem_read":
    case "file_read":
      return "filesystem_read";

    case "filesystem_write":
    case "file_write":
      return "filesystem_write";

    case "database":
    case "db_query":
    case "sql":
      return "database";

    case "user_input":
    case "human_input":
      return "user_input";

    case "subagent_call":
    case "delegate":
      return "subagent_call";

    default:
      return "custom";
  }
}

/**
 * Derives a standardized dependency identity string from boundary metadata.
 * e.g. "openai:gpt-4o", "tool:fetch_customer", "http:api.stripe.com"
 */
export function deriveDependencyIdentity(
  boundaryType: BoundaryType,
  name: string,
  extra?: { provider?: string; host?: string; service?: string }
): string {
  if (extra?.provider && extra.provider !== "unknown") {
    return `${extra.provider}:${name}`;
  }
  if (extra?.service) {
    return `${extra.service}:${name}`;
  }
  if (extra?.host) {
    return `http:${extra.host}`;
  }

  switch (boundaryType) {
    case "model_call":
      return `model:${name}`;
    case "tool_call":
      return `tool:${name}`;
    case "retrieval_service":
    case "retrieval_call":
      return `retrieval:${name}`;
    case "memory_service":
    case "memory_read":
    case "memory_write":
      return `memory:${name}`;
    case "external_http":
      return `http:${name}`;
    default:
      return `${boundaryType}:${name}`;
  }
}
