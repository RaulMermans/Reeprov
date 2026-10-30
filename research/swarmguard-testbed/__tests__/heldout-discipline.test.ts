import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDetectorAccess, DetectorAccessError } from "../src/detector";
import {
  DETECTOR_ROLE_ENV,
  HELDOUT_ALLOW_ENV,
  HeldOutAccessError,
  assertCanLoadHeldOutOracles,
} from "../src/heldoutAccess";
import { resolveBenchmarkCase } from "../src/experiment";
import {
  SEALED_EVALUATION_FORMAT,
  loadSealedEvaluationPack,
  parseSealedEvaluationPack,
  sealedPackHash,
} from "../src/sealed";
import { useTestStore } from "./helpers";

const prevAllow = process.env[HELDOUT_ALLOW_ENV];
const prevRole = process.env[DETECTOR_ROLE_ENV];

afterEach(() => {
  if (prevAllow === undefined) delete process.env[HELDOUT_ALLOW_ENV];
  else process.env[HELDOUT_ALLOW_ENV] = prevAllow;
  if (prevRole === undefined) delete process.env[DETECTOR_ROLE_ENV];
  else process.env[DETECTOR_ROLE_ENV] = prevRole;
});

describe("P3 held-out evaluation discipline", () => {
  const store = useTestStore("p3-heldout");

  it("blocks held-out oracle loading from a detector-role workspace", async () => {
    process.env[DETECTOR_ROLE_ENV] = "1";
    process.env[HELDOUT_ALLOW_ENV] = "1";
    expect(() => assertCanLoadHeldOutOracles("test")).toThrow(HeldOutAccessError);
    await expect(resolveBenchmarkCase("se-h01")).rejects.toBeInstanceOf(HeldOutAccessError);
  });

  it("blocks in-tree held-out cases until evaluator allow is set", async () => {
    delete process.env[HELDOUT_ALLOW_ENV];
    delete process.env[DETECTOR_ROLE_ENV];
    await expect(resolveBenchmarkCase("se-h01")).rejects.toBeInstanceOf(HeldOutAccessError);
    process.env[HELDOUT_ALLOW_ENV] = "1";
    const spec = await resolveBenchmarkCase("se-h01");
    expect(spec.partition).toBe("held_out");
    expect(spec.oracle.length).toBeGreaterThan(0);
  });

  it("allows development cases without the held-out gate", async () => {
    delete process.env[HELDOUT_ALLOW_ENV];
    const spec = await resolveBenchmarkCase("se-d01");
    expect(spec.partition).toBe("development");
  });

  it("refuses detector reads of oracle filenames", async () => {
    const detector = createDetectorAccess(store.outputDir());
    await expect(detector.readAllowedFile("run_x", "oracles.heldout.v1.json")).rejects.toBeInstanceOf(
      DetectorAccessError
    );
  });

  it("loads independently sealed evaluation packs by hash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p3-sealed-"));
    const pack = {
      format: SEALED_EVALUATION_FORMAT,
      version: "operator.sealed.v1",
      cases: [
        {
          case_id: "sealed-se-01",
          partition: "held_out" as const,
          domain_id: "software-engineering" as const,
          content_variant: "default",
          scenario_id: "se-normalize-severity-v1",
          seed: "sealed-se-01",
          notes: "Operator-held extra case.",
          injection: { enabled: false, config: {} },
          oracle: [
            {
              agent_id: "coder",
              event_kind: "assertion" as const,
              label: "supported" as const,
              responsible_agent_id: "coder",
              justification: "Sealed example.",
            },
          ],
        },
      ],
    };
    const parsed = parseSealedEvaluationPack(pack);
    const path = join(dir, "sealed.private.json");
    await writeFile(path, JSON.stringify(parsed));
    const loaded = await loadSealedEvaluationPack(path, { [HELDOUT_ALLOW_ENV]: "1" });
    expect(loaded.integrity_hash).toBe(sealedPackHash(parsed));
    expect(loaded.cases[0]?.case_id).toBe("sealed-se-01");
    await expect(
      loadSealedEvaluationPack(path, { REEPROV_P3_DETECTOR_ROLE: "1" })
    ).rejects.toThrow(/Detector-role/);
  });
});
