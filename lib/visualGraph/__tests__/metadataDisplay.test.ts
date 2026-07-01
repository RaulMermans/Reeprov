import { describe, expect, it } from "vitest";
import {
  resolveArtifactType,
  resolveEvalSubtype,
  resolveModelProvider,
  resolveToolSubtype,
} from "@/lib/visualGraph/metadataDisplay";

describe("visual graph semantic identity resolvers", () => {
  it("resolves model provider and model name signals generically", () => {
    expect(resolveModelProvider({ model_provider: "openai", model_name: "gpt-4.1" }).provider).toBe("openai");
    expect(resolveModelProvider({ model_name: "claude-sonnet-4" }).provider).toBe("anthropic");
    expect(resolveModelProvider({ model_name: "gemini-2.5-flash" }).provider).toBe("google");
  });

  it("falls back to unknown provider when provider/model metadata is missing", () => {
    expect(resolveModelProvider(undefined).provider).toBe("unknown");
    expect(resolveModelProvider({ model_name: "unmapped-model" }).label).toBe("unknown");
  });

  it("resolves tool subtype from readable generic tables", () => {
    expect(resolveToolSubtype("web_search").subtype).toBe("web_search");
    expect(resolveToolSubtype("page_content_extract").subtype).toBe("webpage_extract");
    expect(resolveToolSubtype("playwright_browser").subtype).toBe("browser");
    expect(resolveToolSubtype("postgres_query").subtype).toBe("database");
    expect(resolveToolSubtype("octokit_github_issue").subtype).toBe("github");
    expect(resolveToolSubtype("schema_validator").subtype).toBe("validator");
    expect(resolveToolSubtype("opaque").subtype).toBe("unknown_tool");
  });

  it("resolves eval subtype without fixture names", () => {
    expect(resolveEvalSubtype("Output quality").subtype).toBe("quality");
    expect(resolveEvalSubtype("Factual correctness").subtype).toBe("factuality");
    expect(resolveEvalSubtype("Publishability gate").subtype).toBe("publishability");
    expect(resolveEvalSubtype("Trace contract").subtype).toBe("contract");
    expect(resolveEvalSubtype("Safety policy").subtype).toBe("safety");
    expect(resolveEvalSubtype("Source grounding").subtype).toBe("source_evidence");
    expect(resolveEvalSubtype("Opaque").subtype).toBe("unknown_eval");
  });

  it("resolves artifact type from metadata and names", () => {
    expect(resolveArtifactType("draft.md").type).toBe("markdown");
    expect(resolveArtifactType("payload.json").type).toBe("json");
    expect(resolveArtifactType("qa-report").type).toBe("report");
    expect(resolveArtifactType("chart.png").type).toBe("image");
    expect(resolveArtifactType("rows.csv").type).toBe("dataset");
    expect(resolveArtifactType("archive.zip").type).toBe("file");
    expect(resolveArtifactType(undefined).type).toBe("unknown_artifact");
  });
});
