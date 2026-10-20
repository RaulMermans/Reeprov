/**
 * Independent incident-triage replay smoke tests.
 *
 * Uses Reeprov's actual normalization and strict replay resolver, not prebuilt
 * canonical fixtures. Read-only tool calls represent an external mini-agent.
 * Test only: no credentials, network access, or production mutations.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeBoundary } from "../normalizeBoundary";
import { InMemoryContentStore, setContentStore } from "../contentStore";
import { BoundaryResolver, BoundaryResolutionError } from "../../replay/resolver";

describe("Independent incident triage: capture -> strict replay", () => {
  beforeEach(() => {
    setContentStore(new InMemoryContentStore());
  });

  it("replays an externally generated read-only tool result and detects diverged inputs", async () => {
    const input = { incidentId: "INC-725", service: "payments" };
    const output = { errorRatePct: 34, affectedCustomers: 3900 };
    const captured = await normalizeBoundary({
      runId: "external-agent-smoke-plain",
      sequenceIndex: 0,
      boundaryType: "tool_call",
      name: "lookup_incident_metrics",
      input,
      output,
      declaredSideEffectClass: "read_only",
    });

    const replay = new BoundaryResolver([captured]);
    const result = await replay.resolve({
      expectedType: "tool_call",
      name: "lookup_incident_metrics",
      input,
      sideEffectIntent: "substitute_recorded",
    });
    expect(result.output).toEqual(output);

    const divergedReplay = new BoundaryResolver([captured]);
    await expect(divergedReplay.resolve({
      expectedType: "tool_call",
      name: "lookup_incident_metrics",
      input: { ...input, incidentId: "INC-726" },
      sideEffectIntent: "substitute_recorded",
    })).rejects.toMatchObject({
      divergenceType: "INPUT_HASH_MISMATCH",
    } satisfies Partial<BoundaryResolutionError>);
  });

  it("replays the identical original input after mandatory secret redaction", async () => {
    // A fake value in a sensitive field, never a live credential.
    const input = {
      incidentId: "INC-725",
      api_key: "synthetic-smoke-test-credential",
    };
    const output = { errorRatePct: 34 };
    const captured = await normalizeBoundary({
      runId: "external-agent-smoke-redacted",
      sequenceIndex: 0,
      boundaryType: "tool_call",
      name: "lookup_incident_metrics",
      input,
      output,
      declaredSideEffectClass: "read_only",
    });

    expect(JSON.stringify(captured)).not.toContain(input.api_key);
    expect(captured.input.hash).toBeDefined();

    // A replaying real agent naturally supplies the same original tool args.
    // With no logical input change, strict replay should not report divergence.
    const replay = new BoundaryResolver([captured]);
    const result = await replay.resolve({
      expectedType: "tool_call",
      name: "lookup_incident_metrics",
      input,
      sideEffectIntent: "substitute_recorded",
    });
    expect(result.output).toEqual(output);
  });
});
