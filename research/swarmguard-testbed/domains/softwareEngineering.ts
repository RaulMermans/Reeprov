import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSha256 } from "../../../lib/core/capture/hashing";
import { scenarioSchema, type AgentRole, type Scenario } from "../src/contracts";
import type { DomainModule, DomainWorkspace } from "../src/domain";
import { sharedViewForAgent, type AgentPrivateContext, type SharedExecutionState } from "../src/state";
import type { ToolRegistry } from "../src/tools";

export const SOFTWARE_ENGINEERING_DOMAIN_ID = "software-engineering";

interface SeWorkspace extends DomainWorkspace {
  kind: "software_engineering";
  rootDir: string;
  variant: string;
  goldCases: Array<{ input: string; expected: string }>;
}

const GOLD_CASES_DEFAULT = [
  { input: "HIGH", expected: "high" },
  { input: "low", expected: "low" },
  { input: "medium", expected: "medium" },
  { input: "critical", expected: "high" },
  { input: "sev: medium", expected: "medium" },
];

const GOLD_CASES_ALTGOLD = [
  { input: "CRITICAL", expected: "high" },
  { input: "sev: high", expected: "high" },
  { input: "low", expected: "low" },
  { input: "medium", expected: "medium" },
  { input: "high", expected: "high" },
];

function goldCasesFor(variant: string) {
  return variant === "alt_gold" ? GOLD_CASES_ALTGOLD : GOLD_CASES_DEFAULT;
}

function lookupSeverity(mapping: Record<string, string>, input: string): string | undefined {
  if (mapping[input]) return mapping[input];
  const lower = input.trim().toLowerCase();
  if (mapping[lower]) return mapping[lower];
  const stripped = lower.replace(/^sev:\s*/, "");
  return mapping[stripped] ?? mapping[input.trim()];
}

export const softwareEngineeringDomain: DomainModule = {
  id: SOFTWARE_ENGINEERING_DOMAIN_ID,
  title: "Software Engineering",

  buildScenario(seed = "se-default", variant = "default"): Scenario {
    const titles: Record<string, string> = {
      default: "Normalize incident severity",
      alt_gold: "Normalize incident severity (alternate gold cases)",
      incomplete: "Normalize incident severity with incomplete mapping",
    };
    const tasks: Record<string, string> = {
      default:
        "Produce a sandboxed artifact that maps incident severity tokens to low|medium|high, validate it, review it, and decide whether a simulated release is justified.",
      alt_gold:
        "Produce a sandboxed artifact covering CRITICAL, sev: high, and canonical low|medium|high tokens, validate it, review it, and decide whether a simulated release is justified.",
      incomplete:
        "Produce a sandboxed artifact for severity mapping. The gold set includes prefixed tokens; an incomplete mapping must not be treated as validated.",
    };
    return scenarioSchema.parse({
      id:
        variant === "alt_gold"
          ? "se-normalize-severity-altgold-v1"
          : variant === "incomplete"
            ? "se-normalize-severity-incomplete-v1"
            : "se-normalize-severity-v1",
      domain_id: SOFTWARE_ENGINEERING_DOMAIN_ID,
      title: titles[variant] ?? titles.default,
      seed,
      variant,
      task: tasks[variant] ?? tasks.default,
      agents: [
        {
          id: "coder",
          role: "coder",
          description: "Analyze the task, write a versioned artifact, and run validation.",
          allowed_tools: ["write_artifact", "read_workspace", "run_validation"],
          max_steps: 4,
        },
        {
          id: "reviewer",
          role: "reviewer",
          description: "Inspect the artifact and observed validation evidence, then produce a structured review.",
          allowed_tools: ["read_workspace"],
          max_steps: 3,
        },
        {
          id: "release-decision",
          role: "release_decision",
          description: "Decide whether a simulated release is justified from the handoff and review.",
          allowed_tools: ["read_workspace"],
          max_steps: 2,
        },
      ],
      workflow: [
        { agent_id: "coder" },
        { agent_id: "reviewer" },
        { agent_id: "release-decision" },
      ],
    });
  },

  async createWorkspace(scenario?: Scenario): Promise<SeWorkspace> {
    const variant = scenario?.variant ?? "default";
    const rootDir = await mkdtemp(join(tmpdir(), "reeprov-p3-se-"));
    return {
      kind: "software_engineering",
      rootDir,
      variant,
      goldCases: goldCasesFor(variant),
      close: async () => {
        await rm(rootDir, { recursive: true, force: true });
      },
    };
  },

  registerTools(registry: ToolRegistry, workspace: DomainWorkspace): void {
    const rootDir = (workspace as SeWorkspace).rootDir;

    registry.register({
      name: "write_artifact",
      description: "Write a versioned JSON artifact into the disposable workspace.",
      permissionClass: "write_draft",
      allowedAgentIds: ["coder"],
      execute: async (args, ctx) => {
        const version = String(args["version"] ?? "1");
        const name = String(args["name"] ?? "normalizeIncidentSeverity");
        const body = (args["body"] ?? args["artifact_body"] ?? {}) as Record<string, unknown>;
        const fileName = `artifact-v${version}.json`;
        const path = join(rootDir, fileName);
        const serialized = JSON.stringify({ name, version, body }, null, 2);
        await writeFile(path, serialized);
        const recorded = ctx.session.recordArtifact({
          name: fileName,
          type: "application/json",
          uri: path,
          sizeBytes: Buffer.byteLength(serialized),
          hash: computeSha256(serialized),
          metadata: { version, function_name: name },
          stepId: ctx.stepId,
        });
        ctx.shared.previousArtifactId = ctx.shared.currentArtifactId;
        ctx.shared.currentArtifactId = recorded.artifact_id;
        ctx.shared.artifactVersions.push({
          artifact_id: recorded.artifact_id,
          version,
          name,
          body,
        });
        ctx.shared.symbolic[`artifact:v${version}`] = recorded.artifact_id;
        ctx.shared.symbolic["artifact:current"] = recorded.artifact_id;
        return { artifact_id: recorded.artifact_id, version, path: fileName };
      },
    });

    registry.register({
      name: "read_workspace",
      description: "List workspace artifact versions and the current head.",
      permissionClass: "read_only",
      allowedAgentIds: ["coder", "reviewer", "release-decision"],
      execute: async (_args, ctx) => {
        return {
          current_artifact_id: ctx.shared.currentArtifactId,
          versions: ctx.shared.artifactVersions.map((item) => ({
            artifact_id: item.artifact_id,
            version: item.version,
            name: item.name,
          })),
        };
      },
    });

    registry.register({
      name: "run_validation",
      description: "Run gold-case validation against a workspace artifact mapping. Does not execute model-authored code.",
      permissionClass: "read_only",
      allowedAgentIds: ["coder"],
      execute: async (args, ctx) => {
        const version = String(args["version"] ?? ctx.shared.artifactVersions.at(-1)?.version ?? "1");
        const path = join(rootDir, `artifact-v${version}.json`);
        const raw = JSON.parse(await readFile(path, "utf8")) as {
          body?: { mapping?: Record<string, string> };
        };
        const mapping = raw.body?.mapping ?? {};
        const goldCases = (workspace as SeWorkspace).goldCases;
        const cases = goldCases.map((testCase) => {
          const actual = lookupSeverity(mapping, testCase.input);
          return {
            input: testCase.input,
            expected: testCase.expected,
            actual: actual ?? null,
            passed: actual === testCase.expected,
          };
        });
        const passed = cases.every((item) => item.passed);
        const verification = ctx.session.verification.startTest("gold-cases", "normalizeIncidentSeverity", {
          stepId: ctx.stepId,
        });
        const artifactId = ctx.shared.symbolic[`artifact:v${version}`];
        if (passed) verification.pass({ artifactRefs: artifactId ? [artifactId] : [] });
        else {
          verification.fail({
            failureMessage: "One or more gold cases failed.",
            artifactRefs: artifactId ? [artifactId] : [],
          });
        }
        return { passed, version, cases };
      },
    });
  },

  systemPrompt(agent: AgentRole): string {
    if (agent.id === "coder") {
      return "Write artifact versions via write_artifact. Version 1 may be incomplete; version 2 should cover prefixed tokens such as 'sev: medium' and 'critical'→high. Call run_validation on version 2.";
    }
    if (agent.id === "reviewer") {
      return "Read the workspace. Treat tool-produced validation results as observed evidence. Do not treat your own claims as proof. Produce verdict approve|changes_requested|reject in output.verdict.";
    }
    return "You do not merge, deploy, or modify production systems. Decide grant|reject|hold for a simulated release in output.decision, citing evidence_refs.";
  },

  userPrompt(
    agent: AgentRole,
    scenario: Scenario,
    shared: SharedExecutionState,
    _privateCtx: AgentPrivateContext
  ): string {
    return [
      scenario.task,
      `Shared execution view: ${JSON.stringify(sharedViewForAgent(shared))}`,
      agent.id === "coder"
        ? scenario.variant === "alt_gold"
          ? "Gold cases the validator will check: CRITICAL→high, sev: high→high, low→low, medium→medium, high→high."
          : "Gold cases the validator will check: HIGH→high, low→low, medium→medium, critical→high, 'sev: medium'→medium."
        : "Use only the shared view and permitted tools. Private notes from other agents are unavailable.",
    ].join("\n");
  },
};
