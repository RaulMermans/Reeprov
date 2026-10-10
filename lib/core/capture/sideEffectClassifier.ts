/**
 * Deterministic Side-Effect Classification.
 *
 * Classifies execution boundaries by their real-world impact and mutation level.
 *
 * Core Safety Rule:
 * When a boundary's side-effect profile is unknown or ambiguous, it MUST NOT
 * default to "read_only". It must fail closed (e.g. "external_side_effect" or "sensitive_data")
 * to prevent accidental live execution or unsafe automatic substitution.
 */

import type { BoundaryType, SideEffectClass } from "../contracts/replay";

const READ_ONLY_TOOL_PREFIXES = [
  "get_",
  "read_",
  "fetch_",
  "search_",
  "list_",
  "lookup_",
  "find_",
  "query_",
  "describe_",
  "inspect_",
  "check_",
  "view_",
  "scan_",
];

const WRITE_DRAFT_TOOL_PREFIXES = [
  "draft_",
  "create_draft",
  "save_draft",
  "write_draft",
  "stage_",
  "prepare_",
  "temp_",
  "scratch_",
];

const DESTRUCTIVE_TOOL_KEYWORDS = [
  "delete_all",
  "purge",
  "drop_table",
  "destroy",
  "wipe",
  "terminate",
  "cancel_all",
  "hard_delete",
];

const SENSITIVE_KEYWORDS = [
  "auth",
  "token",
  "credential",
  "secret",
  "key",
  "password",
  "decrypt",
  "wallet",
  "payment",
];

/**
 * Classifies the side-effect class of an execution boundary.
 *
 * @param boundaryType The boundary category (e.g. model_call, tool_call, external_http)
 * @param name The specific name of the tool, URL, or provider
 * @param declared Explicitly declared side effect class from adapter/instrumentation
 * @param httpMethod HTTP method if applicable (e.g. GET, POST)
 */
export function classifySideEffect(
  boundaryType: BoundaryType,
  name: string,
  declared?: SideEffectClass,
  httpMethod?: string
): SideEffectClass {
  // 1. Explicit declaration takes precedence if valid
  if (declared) {
    return declared;
  }

  const lowerName = name.toLowerCase();

  // 2. Sensitive keywords check
  if (SENSITIVE_KEYWORDS.some((kw) => lowerName.includes(kw))) {
    return "sensitive_data";
  }

  // 3. HTTP requests
  if (boundaryType === "external_http" || httpMethod) {
    const method = (httpMethod || "").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return "read_only";
    }
    if (method === "DELETE") {
      return "destructive";
    }
    if (method === "POST" || method === "PUT" || method === "PATCH") {
      return "external_side_effect";
    }
    // Unknown HTTP method -> fail closed!
    return "external_side_effect";
  }

  // 4. Model calls (LLM generation without tool execution is inherently read-only)
  if (boundaryType === "model_call") {
    return "read_only";
  }

  // 5. Retrieval operations (vector / keyword search is read-only)
  if (boundaryType === "retrieval_service" || boundaryType === "retrieval_call") {
    return "read_only";
  }

  // 6. Memory operations
  if (boundaryType === "memory_read") {
    return "read_only";
  }
  if (boundaryType === "memory_write") {
    return "external_side_effect";
  }
  if (boundaryType === "memory_service") {
    if (lowerName.includes("read") || lowerName.includes("search") || lowerName.includes("get")) {
      return "read_only";
    }
    return "external_side_effect";
  }

  // 7. Filesystem
  if (boundaryType === "filesystem_read") {
    return "read_only";
  }
  if (boundaryType === "filesystem_write") {
    return "write_draft";
  }

  // 8. Tool calls: evaluate prefixes and keywords
  if (boundaryType === "tool_call") {
    if (DESTRUCTIVE_TOOL_KEYWORDS.some((kw) => lowerName.includes(kw))) {
      return "destructive";
    }
    if (WRITE_DRAFT_TOOL_PREFIXES.some((pre) => lowerName.startsWith(pre))) {
      return "write_draft";
    }
    if (READ_ONLY_TOOL_PREFIXES.some((pre) => lowerName.startsWith(pre))) {
      return "read_only";
    }

    // Common write-like prefixes
    if (
      lowerName.startsWith("send_") ||
      lowerName.startsWith("post_") ||
      lowerName.startsWith("create_") ||
      lowerName.startsWith("update_") ||
      lowerName.startsWith("delete_") ||
      lowerName.startsWith("charge_") ||
      lowerName.startsWith("execute_")
    ) {
      return "external_side_effect";
    }

    // UNKNOWN tool: DO NOT guess read_only! Fail closed!
    return "external_side_effect";
  }

  // 9. Any other boundary type: fail closed to external_side_effect
  return "external_side_effect";
}
