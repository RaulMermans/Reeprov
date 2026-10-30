/**
 * CLI for the SwarmGuard research testbed.
 *
 *   npx tsx research/swarmguard-testbed/scripts/run.ts --domain se --mode offline_fixture
 *   npx tsx research/swarmguard-testbed/scripts/run.ts --domain investigation --mode live_llm
 */

import { join } from "node:path";
import { getDomain } from "../src/index";
import { runExperiment } from "../src/harness";
import { NO_INJECTION, injectionPlanSchema, type InjectionPlan } from "../src/contracts";
import { classifyRecordedInvocations } from "../src/modes";

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const domainId = arg("--domain") ?? "se";
const mode = arg("--mode") ?? "offline_fixture";
const inject = arg("--inject");
const seed = arg("--seed") ?? "cli";
const outputDir = arg("--output") ?? join(process.cwd(), "research/swarmguard-testbed/.output");

let injection: InjectionPlan = NO_INJECTION;
if (inject) {
  injection = injectionPlanSchema.parse({
    enabled: true,
    type: inject,
    target_agent_id: arg("--target-agent"),
    expected_observable_violation: arg("--expected"),
    config: {
      ...(arg("--foreign-run") ? { foreign_run_id: arg("--foreign-run") } : {}),
      ...(arg("--claim") ? { claim: arg("--claim") } : {}),
    },
  });
}

const domain = getDomain(domainId);
const result = await runExperiment(domain, {
  mode,
  injection,
  seed,
  outputDir,
  persist: true,
});

const recordedMode = classifyRecordedInvocations(result.artifact.models);
const liveProven =
  result.requested_mode === "live_llm" &&
  result.execution_mode === "live_llm" &&
  recordedMode === "live_llm" &&
  result.artifact.models.every((model) => model.metadata?.["provider_http_completed"] === true);

const report = {
  domain: result.domain_id,
  scenario_id: result.scenario_id,
  run_id: result.run_id,
  requested_mode: result.requested_mode,
  execution_mode: result.execution_mode,
  recorded_invocation_mode: recordedMode,
  live_llm_proven: liveProven,
  live_blocked: result.live_blocked,
  status: result.status,
  participating_agent_ids: result.participating_agent_ids,
  handoffs: (result.artifact.handoffs ?? []).map((handoff) => ({
    from: handoff.from_agent_id,
    to: handoff.to_agent_id,
    attribution: handoff.attribution_status,
  })),
  model_calls: result.artifact.models.map((model) => ({
    agent_id: model.agent_id,
    provider: model.provider,
      model: model.model_name,
    execution_mode: model.metadata?.["execution_mode"],
    provider_http_completed: model.metadata?.["provider_http_completed"] === true,
    tokens: model.total_tokens,
    cost_usd: model.cost_usd,
  })),
  tools: result.artifact.tools.map((tool) => ({
    agent_id: tool.agent_id,
    tool_name: tool.tool_name,
    status: tool.status,
  })),
  control: result.ground_truth.control,
  injection_count: result.ground_truth.injections.length,
  export: result.persisted?.summary.artifact_dir,
  errors: result.errors,
};

console.log(JSON.stringify(report, null, 2));

if (hasFlag("--require-live") || result.requested_mode === "live_llm") {
  if (!liveProven) {
    console.error(
      result.live_blocked ??
        "live_llm was requested but provider HTTP completion was not proven. Offline fixtures are not live execution."
    );
    process.exit(2);
  }
}
