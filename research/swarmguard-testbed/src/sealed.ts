/**
 * Independently sealed evaluation cases.
 *
 * In-tree held-out labels from p3.benchmark.v1 are public. New H2 evaluation
 * cases should live in an operator-held JSON file, referenced by
 * REEPROV_P3_SEALED_EVALUATION_PATH, and identified only by content hash in
 * the public protocol record.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { injectionPlanSchema, type AgentTurn } from "./contracts";
import type { BenchmarkCase, Partition } from "./benchmark";
import { sha256Json } from "./benchmark";
import { detectorRoleEnabled, SEALED_EVAL_ENV } from "./heldoutAccess";
import type { OracleTemplate } from "./oracle";

export const SEALED_EVALUATION_FORMAT = "reeprov.swarmguard_testbed.sealed_evaluation.v1" as const;

const oracleTemplateSchema = z.object({
  agent_id: z.string(),
  event_kind: z.enum(["assertion", "handoff"]),
  assertion_index: z.number().int().nonnegative().optional(),
  label: z.enum(["supported", "contradicted", "insufficient_evidence"]),
  defect_class: z
    .enum([
      "none",
      "factual_contradiction",
      "provenance_integrity",
      "missing_resolving_evidence",
      "unexecuted_observation",
      "payload_tamper",
    ])
    .optional(),
  responsible_agent_id: z.string(),
  justification: z.string(),
});

const sealedCaseSchema = z.object({
  case_id: z.string(),
  partition: z.literal("held_out"),
  domain_id: z.enum(["software-engineering", "investigation"]),
  content_variant: z.string(),
  scenario_id: z.string(),
  seed: z.string(),
  notes: z.string(),
  injection: injectionPlanSchema,
  oracle: z.array(oracleTemplateSchema).min(1),
  fixtureTurns: z.record(z.string(), z.unknown()).optional(),
});

export const sealedEvaluationPackSchema = z.object({
  format: z.literal(SEALED_EVALUATION_FORMAT),
  version: z.string(),
  cases: z.array(sealedCaseSchema).min(1),
});

export type SealedEvaluationPack = z.infer<typeof sealedEvaluationPackSchema>;

export class SealedEvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SealedEvaluationError";
  }
}

export function sealedPackHash(pack: SealedEvaluationPack): string {
  return sha256Json(pack);
}

export function parseSealedEvaluationPack(raw: unknown): SealedEvaluationPack {
  return sealedEvaluationPackSchema.parse(raw);
}

export function sealedCasesToBenchmark(pack: SealedEvaluationPack): BenchmarkCase[] {
  return pack.cases.map((item) => ({
    case_id: item.case_id,
    partition: item.partition as Partition,
    domain_id: item.domain_id,
    content_variant: item.content_variant,
    scenario_id: item.scenario_id,
    seed: item.seed,
    notes: item.notes,
    injection: item.injection,
    oracle: item.oracle as OracleTemplate[],
    fixtureTurns: item.fixtureTurns as Record<string, AgentTurn> | undefined,
  }));
}

export async function loadSealedEvaluationPack(
  path = process.env[SEALED_EVAL_ENV],
  env: NodeJS.ProcessEnv = process.env
): Promise<{ pack: SealedEvaluationPack; cases: BenchmarkCase[]; integrity_hash: string; path: string }> {
  if (detectorRoleEnabled(env)) {
    throw new SealedEvaluationError("Detector-role workspace cannot load sealed evaluation packs.");
  }
  if (!path) {
    throw new SealedEvaluationError(
      `No sealed evaluation pack. Set ${SEALED_EVAL_ENV} to an operator-held JSON file.`
    );
  }
  const parsed = parseSealedEvaluationPack(JSON.parse(await readFile(path, "utf8")));
  return {
    pack: parsed,
    cases: sealedCasesToBenchmark(parsed),
    integrity_hash: sealedPackHash(parsed),
    path,
  };
}
