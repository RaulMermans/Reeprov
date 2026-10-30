import { scenarioSchema, type AgentRole, type Scenario } from "../src/contracts";
import type { DomainModule, DomainWorkspace } from "../src/domain";
import { sharedViewForAgent, type AgentPrivateContext, type SharedExecutionState } from "../src/state";
import type { ToolRegistry } from "../src/tools";

export const INVESTIGATION_DOMAIN_ID = "investigation";

interface IncidentRecord {
  id: string;
  kind: "system_log" | "witness" | "rumor";
  timestamp: string;
  body: string;
}

interface InvestigationWorkspace extends DomainWorkspace {
  kind: "investigation";
  records: IncidentRecord[];
  variant: string;
}

const DATASET_DEFAULT: IncidentRecord[] = [
  {
    id: "SYS-1",
    kind: "system_log",
    timestamp: "2026-10-29T14:01:00.000Z",
    body: "auth failure count=12 from 10.0.0.8 on api-gateway",
  },
  {
    id: "SYS-2",
    kind: "system_log",
    timestamp: "2026-10-29T14:04:00.000Z",
    body: "successful sudo by service-account svc-backup on db-1",
  },
  {
    id: "WIT-1",
    kind: "witness",
    timestamp: "2026-10-29T14:10:00.000Z",
    body: "Operator reported a person at the console in the east rack.",
  },
  {
    id: "RUM-1",
    kind: "rumor",
    timestamp: "2026-10-29T14:12:00.000Z",
    body: "Chat message claiming the intern probably caused it.",
  },
];

const DATASET_SUDO: IncidentRecord[] = [
  {
    id: "SYS-1",
    kind: "system_log",
    timestamp: "2026-10-29T15:01:00.000Z",
    body: "auth failure count=3 from 10.0.0.4 on ssh-gateway",
  },
  {
    id: "SYS-2",
    kind: "system_log",
    timestamp: "2026-10-29T15:06:00.000Z",
    body: "successful sudo by service-account svc-restore on db-2",
  },
  {
    id: "WIT-1",
    kind: "witness",
    timestamp: "2026-10-29T15:12:00.000Z",
    body: "Night operator heard disk activity in the west rack.",
  },
  {
    id: "RUM-1",
    kind: "rumor",
    timestamp: "2026-10-29T15:18:00.000Z",
    body: "Chat message claiming a contractor left a laptop unlocked.",
  },
];

function recordsFor(variant: string): IncidentRecord[] {
  return variant === "sudo_focus" ? DATASET_SUDO : DATASET_DEFAULT;
}

export const investigationDomain: DomainModule = {
  id: INVESTIGATION_DOMAIN_ID,
  title: "Investigation",

  buildScenario(seed = "inv-default", variant = "default"): Scenario {
    return scenarioSchema.parse({
      id: variant === "sudo_focus" ? "inv-sudo-restore-v1" : "inv-auth-burst-v1",
      domain_id: INVESTIGATION_DOMAIN_ID,
      title:
        variant === "sudo_focus" ? "Privileged-restore incident" : "Authentication-burst incident",
      seed,
      variant,
      task:
        variant === "sudo_focus"
          ? "Examine the incident records about a restore-account sudo event, report findings with source citations, validate whether findings are supported, and choose a simulated resolution."
          : "Examine the incident records, report findings with source citations, validate whether findings are supported, and choose a simulated resolution.",
      agents: [
        {
          id: "investigator",
          role: "investigator",
          description: "Examine records and report findings that cite source record ids.",
          allowed_tools: ["list_records", "read_record", "search_records"],
          max_steps: 4,
        },
        {
          id: "validator",
          role: "validator",
          description: "Assess whether reported findings are supported by source evidence.",
          allowed_tools: ["list_records", "read_record", "validate_findings"],
          max_steps: 3,
        },
        {
          id: "decision",
          role: "decision",
          description: "Choose a simulated resolution based on received findings and validation.",
          allowed_tools: [],
          max_steps: 2,
        },
      ],
      workflow: [
        { agent_id: "investigator" },
        { agent_id: "validator" },
        { agent_id: "decision" },
      ],
    });
  },

  async createWorkspace(scenario?: Scenario): Promise<InvestigationWorkspace> {
    const variant = scenario?.variant ?? "default";
    return {
      kind: "investigation",
      variant,
      records: recordsFor(variant).map((record) => ({ ...record })),
    };
  },

  async seedEvidence(session, workspace, shared) {
    const records = (workspace as InvestigationWorkspace).records;
    for (const record of records) {
      const artifact = session.recordArtifact({
        name: record.id,
        type: `incident_record/${record.kind}`,
        metadata: { kind: record.kind, timestamp: record.timestamp },
      });
      shared.symbolic[`record:${record.id}`] = artifact.artifact_id;
      shared.artifactVersions.push({
        artifact_id: artifact.artifact_id,
        version: record.id,
        name: record.id,
        body: record,
      });
    }
    const v1 = session.recordArtifact({
      name: "case-file-v1",
      type: "application/json",
      metadata: { version: "1", kind: "case_file" },
    });
    const v2 = session.recordArtifact({
      name: "case-file-v2",
      type: "application/json",
      metadata: { version: "2", kind: "case_file" },
    });
    shared.previousArtifactId = v1.artifact_id;
    shared.currentArtifactId = v2.artifact_id;
    shared.symbolic["artifact:v1"] = v1.artifact_id;
    shared.symbolic["artifact:v2"] = v2.artifact_id;
    shared.symbolic["artifact:current"] = v2.artifact_id;
    shared.artifactVersions.push(
      { artifact_id: v1.artifact_id, version: "1", name: "case-file-v1", body: { records: records.map((r) => r.id) } },
      { artifact_id: v2.artifact_id, version: "2", name: "case-file-v2", body: { records: records.map((r) => r.id), compiled: true } }
    );
  },

  registerTools(registry: ToolRegistry, workspace: DomainWorkspace): void {
    const records = (workspace as InvestigationWorkspace).records;

    registry.register({
      name: "list_records",
      description: "List incident record ids and kinds.",
      permissionClass: "read_only",
      allowedAgentIds: ["investigator", "validator"],
      execute: async () => records.map((record) => ({ id: record.id, kind: record.kind, timestamp: record.timestamp })),
    });

    registry.register({
      name: "read_record",
      description: "Read one incident record by id.",
      permissionClass: "read_only",
      allowedAgentIds: ["investigator", "validator"],
      execute: async (args) => {
        const id = String(args["id"] ?? args["record_id"] ?? "");
        const record = records.find((item) => item.id === id);
        if (!record) throw new Error(`Unknown record ${id}`);
        return record;
      },
    });

    registry.register({
      name: "search_records",
      description: "Search record bodies for a case-insensitive query.",
      permissionClass: "read_only",
      allowedAgentIds: ["investigator"],
      execute: async (args) => {
        const query = String(args["query"] ?? "").toLowerCase();
        return records.filter(
          (record) =>
            record.body.toLowerCase().includes(query) ||
            record.id.toLowerCase().includes(query) ||
            record.kind.toLowerCase().includes(query)
        );
      },
    });

    registry.register({
      name: "validate_findings",
      description: "Check whether cited findings resolve to documentary records. Does not invent support.",
      permissionClass: "read_only",
      allowedAgentIds: ["validator"],
      execute: async (args, ctx) => {
        const cited = Array.isArray(args["record_ids"])
          ? args["record_ids"].map(String)
          : records.map((record) => record.id);
        const known = new Set(records.map((record) => record.id));
        const assessments = cited.map((id) => {
          const record = records.find((item) => item.id === id);
          return {
            record_id: id,
            found: known.has(id),
            kind: record?.kind ?? null,
            rumor_only: record?.kind === "rumor",
          };
        });
        const toolCallEvidence = ctx.shared.toolEvidence.map((item) => item.tool_name);
        return { assessments, checked: cited.length, prior_tools: toolCallEvidence };
      },
    });
  },

  systemPrompt(agent: AgentRole): string {
    if (agent.id === "investigator") {
      return "Cite record ids in assertions.evidence_refs as record:SYS-1. Distinguish system_log, witness, and rumor sources. Do not treat rumor as system evidence.";
    }
    if (agent.id === "validator") {
      return "For each finding, set output.assessments to { finding_id, supported, reason, record_ids }. A rumor cannot solely support a high-severity finding.";
    }
    return "Choose output.resolution as escalate|close|monitor|request_more_evidence. This is a simulated resolution only.";
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
      "Source records are documentary evidence with kinds system_log, witness, and rumor — not software artifacts or unit-test results.",
    ].join("\n");
  },
};
