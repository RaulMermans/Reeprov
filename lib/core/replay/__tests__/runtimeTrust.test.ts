import { beforeEach, describe, expect, it } from "vitest";
import { normalizeBoundary } from "../../capture/normalizeBoundary";
import { InMemoryContentStore, setContentStore } from "../../capture/contentStore";
import { BoundaryResolver } from "../resolver";
import { ReplayRuntime } from "../runtime";
import { runArtifactSchema } from "../../contracts/runArtifact";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("capture to replay evidence contract", () => {
  beforeEach(() => setContentStore(new InMemoryContentStore()));

  const capture = (input: unknown, output: unknown = { answer: 7 }) => normalizeBoundary({
    runId: "s12-replay",
    sequenceIndex: 0,
    boundaryType: "tool_call",
    name: "lookup_incident",
    dependencyIdentity: "tool:lookup_incident",
    input,
    output,
    declaredSideEffectClass: "read_only",
  });
  const request = (input: unknown) => ({
    expectedType: "tool_call" as const,
    name: "lookup_incident",
    dependencyIdentity: "tool:lookup_incident",
    input,
    sideEffectIntent: "substitute_recorded" as const,
  });

  it("fully verifies identical ordinary input", async () => {
    const boundary = await capture({ incident: "INC-7" });
    const result = await new BoundaryResolver([boundary]).resolve(request({ incident: "INC-7" }));
    expect(result.inputVerification).toBe("FULL");
    expect(result.output).toEqual({ answer: 7 });
  });

  it("rejects an ordinary input change", async () => {
    const boundary = await capture({ incident: "INC-7" });
    await expect(new BoundaryResolver([boundary]).resolve(request({ incident: "INC-8" })))
      .rejects.toMatchObject({ divergenceType: "INPUT_HASH_MISMATCH" });
  });

  it("substitutes a redacted input only with partial verification", async () => {
    const input = { incident: "INC-7", api_key: "synthetic-one" };
    const boundary = await capture(input);
    expect(JSON.stringify(boundary)).not.toContain("synthetic-one");
    const result = await new BoundaryResolver([boundary]).resolve(request(input));
    expect(result.inputVerification).toBe("PARTIAL");
  });

  it("never fully verifies two credentials masked to the same value", async () => {
    const boundary = await capture({ incident: "INC-7", api_key: "synthetic-one" });
    const result = await new BoundaryResolver([boundary]).resolve(request({ incident: "INC-7", api_key: "synthetic-two" }));
    expect(result.inputVerification).toBe("PARTIAL");
  });

  it("fails closed when exact verification is required for redacted input", async () => {
    const boundary = await capture({ incident: "INC-7", api_key: "synthetic-one" });
    await expect(new BoundaryResolver([boundary], { requireExactInputVerification: true })
      .resolve(request({ incident: "INC-7", api_key: "synthetic-one" })))
      .rejects.toMatchObject({ divergenceType: "INPUT_UNVERIFIABLE" });
  });

  it("requires captured output", async () => {
    const boundary = await normalizeBoundary({
      runId: "s12-replay", sequenceIndex: 0, boundaryType: "tool_call",
      name: "lookup_incident", dependencyIdentity: "tool:lookup_incident",
      input: { incident: "INC-7" }, declaredSideEffectClass: "read_only",
    });
    await expect(new BoundaryResolver([boundary]).resolve(request({ incident: "INC-7" })))
      .rejects.toMatchObject({ divergenceType: "MISSING_PAYLOAD" });
  });

  it("rejects corrupted output evidence", async () => {
    const boundary = await capture({ incident: "INC-7" });
    boundary.output!.content = { answer: 8 };
    await expect(new BoundaryResolver([boundary]).resolve(request({ incident: "INC-7" })))
      .rejects.toMatchObject({ divergenceType: "OUTPUT_MISMATCH" });
  });

  it("rejects a wrong dependency identity even when the name matches", async () => {
    const boundary = await capture({ incident: "INC-7" });
    await expect(new BoundaryResolver([boundary]).resolve({
      ...request({ incident: "INC-7" }), dependencyIdentity: "tool:other",
    })).rejects.toMatchObject({ divergenceType: "BOUNDARY_IDENTITY_MISMATCH" });
  });

  it("treats a legacy input without a hash as unverifiable", async () => {
    const boundary = await capture({ incident: "INC-7" });
    delete boundary.input.hash;
    delete boundary.content_hashes?.input_hash;
    await expect(new BoundaryResolver([boundary]).resolve(request({ incident: "INC-7" })))
      .rejects.toMatchObject({ divergenceType: "INPUT_UNVERIFIABLE" });
  });

  it("refuses a partially replayable artifact in strict offline mode", async () => {
    const artifact = runArtifactSchema.parse(JSON.parse(readFileSync(resolve(
      "tests/fixtures/canonical/fixture-h-vertical-slice.json"), "utf8")));
    const custom = structuredClone(artifact.boundaries[0]);
    custom.boundary_id = "s12-unsupported-checkpoint-event";
    custom.boundary_type = "custom";
    custom.name = "checkpoint-event-only";
    custom.sequence_index = artifact.boundaries.length;
    artifact.boundaries.push(custom);
    const result = await new ReplayRuntime(artifact, { mode: "STRICT_OFFLINE", persist: false }).replay();
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.boundaries_substituted).toBe(0);
    expect(result.limitations).toContainEqual(expect.stringContaining("Unsupported boundary type 'custom'"));
  });
});
