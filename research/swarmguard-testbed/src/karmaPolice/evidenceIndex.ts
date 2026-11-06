/**
 * KARMA POLICE — Cross-Agent Evidence Index.
 *
 * Builds a deterministic, cross-agent index of claims, tools, artifacts,
 * test outcomes, handoffs, and reference resolutions from authorized detector evidence.
 */

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import type { RunEvidenceBundle } from "../../../../lib/core/evidence/exportBundle";
import type { TestResult } from "../../../../lib/core/contracts/evidence";
import type { AgentHandoff } from "../../../../lib/core/contracts/handoff";
import type {
  IndexedArtifact,
  IndexedRecord,
  IndexedTool,
  KarmaPoliceEvidenceIndex,
  EvidenceReferenceResolution,
} from "./types";

export function isCrossRun(ref: string, runId: string): boolean {
  if (ref.startsWith("run_") && !ref.startsWith(`${runId}:`) && ref.includes(":")) {
    return true;
  }
  return false;
}

export function buildEvidenceIndex(
  artifact: RunArtifact,
  bundle?: RunEvidenceBundle
): KarmaPoliceEvidenceIndex {
  const runId = artifact.identity.run_id;

  const artifactsById = new Map<string, IndexedArtifact>();
  const artifactsByVersion = new Map<string, IndexedArtifact>();
  const latestArtifactByName = new Map<string, IndexedArtifact>();
  const toolsById = new Map<string, IndexedTool>();
  const toolsByAgent = new Map<string, IndexedTool[]>();
  const validationTools: IndexedTool[] = [];
  const testsById = new Map<string, TestResult>();
  const testsByArtifact = new Map<string, TestResult[]>();
  const passedTests: TestResult[] = [];
  const failedTests: TestResult[] = [];
  const recordsById = new Map<string, IndexedRecord>();
  const producerOutputsByAgent = new Map<string, { output?: unknown; assertions?: unknown[] }>();
  const handoffsById = new Map<string, AgentHandoff>();
  const handoffsBySender = new Map<string, AgentHandoff[]>();

  // 1. Index Trajectory Steps & Producer Turns
  const stepAgentMap = new Map<string, string>();
  for (const step of artifact.trajectory) {
    if (step.agent_id) {
      stepAgentMap.set(step.step_id, step.agent_id);
    }
  }

  // State snapshots capture canonical agent outputs and assertions
  for (const snapshot of artifact.state ?? []) {
    const data = snapshot.state_data;
    if (data && typeof data === "object") {
      const agentId = (data as Record<string, unknown>)["agent_id"];
      if (typeof agentId === "string") {
        producerOutputsByAgent.set(agentId, {
          output: (data as Record<string, unknown>)["output"],
          assertions: (data as Record<string, unknown>)["delivered_assertions"] as unknown[] | undefined,
        });
      }
    }
  }

  // Model turns may capture original agent outputs and assertions
  for (const model of artifact.models ?? []) {
    const agentId = (model.metadata?.["agent_id"] as string | undefined) ?? model.agent_id;
    const modelRecord = model as unknown as Record<string, unknown>;
    if (agentId && modelRecord["response"] && typeof modelRecord["response"] === "object") {
      const resp = modelRecord["response"] as Record<string, unknown>;
      producerOutputsByAgent.set(agentId, {
        output: resp["output"],
        assertions: Array.isArray(resp["assertions"]) ? resp["assertions"] : undefined,
      });
    }
  }

  // 2. Index Tools
  for (const tool of artifact.tools) {
    const toolName = tool.tool_name;
    const isVal =
      toolName.includes("validation") ||
      toolName.includes("validate") ||
      (tool.output !== undefined &&
        typeof tool.output === "object" &&
        tool.output !== null &&
        typeof (tool.output as Record<string, unknown>)["passed"] === "boolean");

    const isArtWriter =
      toolName.includes("write_artifact") || toolName.includes("artifact");

    const isRecReader =
      toolName.includes("read_record") ||
      toolName.includes("list_records") ||
      toolName.includes("search_records");

    const indexedTool: IndexedTool = {
      tool_call_id: tool.tool_call_id,
      tool_name: tool.tool_name,
      agent_id: tool.agent_id,
      status: tool.status,
      input: tool.input,
      output: tool.output,
      output_summary: tool.output_summary,
      step_id: tool.step_id,
      isValidation: isVal,
      isArtifactWriter: isArtWriter,
      isRecordReader: isRecReader,
    };

    toolsById.set(tool.tool_call_id, indexedTool);

    if (tool.agent_id) {
      const list = toolsByAgent.get(tool.agent_id) ?? [];
      list.push(indexedTool);
      toolsByAgent.set(tool.agent_id, list);
    }

    if (isVal) {
      validationTools.push(indexedTool);
    }

    // Extract documentary records from read_record / list_records outputs
    if (isRecReader && tool.output) {
      if (Array.isArray(tool.output)) {
        for (const item of tool.output) {
          if (item && typeof item === "object" && typeof item["id"] === "string") {
            recordsById.set(item["id"], {
              id: item["id"],
              kind: String(item["kind"] ?? "system_log"),
              body: typeof item["body"] === "string" ? item["body"] : undefined,
              timestamp: typeof item["timestamp"] === "string" ? item["timestamp"] : undefined,
            });
          }
        }
      } else if (typeof tool.output === "object" && tool.output !== null) {
        const item = tool.output as Record<string, unknown>;
        if (typeof item["id"] === "string") {
          recordsById.set(item["id"], {
            id: item["id"],
            kind: String(item["kind"] ?? "system_log"),
            body: typeof item["body"] === "string" ? item["body"] : undefined,
            timestamp: typeof item["timestamp"] === "string" ? item["timestamp"] : undefined,
          });
        }
      }
    }
  }

  // 3. Index Artifacts & Versions
  const rawArtifacts = artifact.artifacts ?? [];
  const artifactsByNameGroup = new Map<string, IndexedArtifact[]>();

  for (const raw of rawArtifacts) {
    let producerAgent = raw.step_id ? stepAgentMap.get(raw.step_id) : undefined;
    if (!producerAgent) {
      const step = artifact.trajectory.find((s) => s.artifact_ids.includes(raw.artifact_id));
      producerAgent = step?.agent_id;
    }

    let version = raw.metadata?.["version"] ? String(raw.metadata["version"]) : undefined;
    if (!version) {
      const match = raw.name.match(/-v(\d+)\.json$/);
      if (match?.[1]) {
        version = match[1];
      }
    }

    // Attempt to extract body from write_artifact tool calls
    let body: unknown = raw.metadata?.["body"];
    if (!body) {
      const writer = Array.from(toolsById.values()).find(
        (t) =>
          t.isArtifactWriter &&
          ((t.output as Record<string, unknown> | undefined)?.["artifact_id"] === raw.artifact_id ||
            String((t.input as Record<string, unknown> | undefined)?.["version"] ?? "") === version)
      );
      if (writer && writer.input && typeof writer.input === "object") {
        body = (writer.input as Record<string, unknown>)["body"] ??
          (writer.input as Record<string, unknown>)["artifact_body"];
      }
    }

    const indexed: IndexedArtifact = {
      artifact_id: raw.artifact_id,
      name: raw.name,
      version,
      producer_agent_id: producerAgent,
      step_id: raw.step_id,
      type: raw.type,
      uri: raw.uri,
      hash: raw.hash,
      isStale: false,
      body,
      metadata: raw.metadata,
      associatedTests: [],
    };

    artifactsById.set(raw.artifact_id, indexed);

    if (raw.type.startsWith("incident_record/")) {
      const rec: IndexedRecord = {
        id: raw.name,
        kind: String(raw.metadata?.["kind"] ?? raw.type.replace("incident_record/", "")),
        body: typeof body === "object" && body !== null && typeof (body as any).body === "string" ? (body as any).body : undefined,
        timestamp: typeof raw.metadata?.["timestamp"] === "string" ? raw.metadata["timestamp"] : undefined,
      };
      recordsById.set(raw.name, rec);
      recordsById.set(raw.artifact_id, rec);
    }

    const groupKey = (raw.metadata?.["function_name"] as string) ?? raw.name.replace(/-v\d+\.json$/, "");
    const list = artifactsByNameGroup.get(groupKey) ?? [];
    list.push(indexed);
    artifactsByNameGroup.set(groupKey, list);
  }

  // Determine Staleness across artifact versions
  for (const [name, list] of artifactsByNameGroup.entries()) {
    if (list.length <= 1) {
      const single = list[0]!;
      latestArtifactByName.set(name, single);
      if (single.version) {
        artifactsByVersion.set(single.version, single);
        artifactsByVersion.set(`v${single.version}`, single);
        artifactsByVersion.set(`artifact:v${single.version}`, single);
      }
      continue;
    }

    // Sort by version number or order of appearance
    list.sort((a, b) => {
      const vA = parseInt(a.version ?? "0", 10);
      const vB = parseInt(b.version ?? "0", 10);
      return vA - vB;
    });

    const latest = list[list.length - 1]!;
    latestArtifactByName.set(name, latest);

    for (let i = 0; i < list.length; i++) {
      const art = list[i]!;
      art.isStale = i < list.length - 1;
      if (art.version) {
        artifactsByVersion.set(art.version, art);
        artifactsByVersion.set(`v${art.version}`, art);
        artifactsByVersion.set(`artifact:v${art.version}`, art);
      }
    }
  }

  // 4. Index Tests
  const tests = artifact.evidence?.test_results ?? [];
  for (const test of tests) {
    testsById.set(test.test_id, test);
    if (test.status === "PASSED") {
      passedTests.push(test);
    } else if (test.status === "FAILED") {
      failedTests.push(test);
    }

    for (const artRef of test.artifact_refs ?? []) {
      const list = testsByArtifact.get(artRef) ?? [];
      list.push(test);
      testsByArtifact.set(artRef, list);

      const indexedArt = artifactsById.get(artRef);
      if (indexedArt) {
        indexedArt.associatedTests.push(test);
      }
    }
  }

  // 5. Index Handoffs
  for (const handoff of artifact.handoffs ?? []) {
    handoffsById.set(handoff.handoff_id, handoff);
    if (handoff.from_agent_id) {
      const list = handoffsBySender.get(handoff.from_agent_id) ?? [];
      list.push(handoff);
      handoffsBySender.set(handoff.from_agent_id, list);
    }
  }

  // 6. Reference Resolution Function
  function resolveReference(ref: string): EvidenceReferenceResolution {
    if (isCrossRun(ref, runId)) {
      return {
        ref,
        status: "cross_run",
        note: `Reference "${ref}" is scoped to another execution run.`,
      };
    }

    if (artifactsById.has(ref)) {
      const art = artifactsById.get(ref)!;
      return {
        ref,
        status: art.isStale ? "stale" : "in_run",
        target_type: "artifact",
        target_id: art.artifact_id,
        producer_agent_id: art.producer_agent_id,
        note: art.isStale ? "Referenced artifact has been superseded by a newer version." : undefined,
      };
    }

    if (toolsById.has(ref)) {
      const tool = toolsById.get(ref)!;
      return {
        ref,
        status: "in_run",
        target_type: "tool",
        target_id: tool.tool_call_id,
        producer_agent_id: tool.agent_id,
      };
    }

    if (testsById.has(ref)) {
      const test = testsById.get(ref)!;
      return {
        ref,
        status: "in_run",
        target_type: "test",
        target_id: test.test_id,
      };
    }

    const strippedRecordId = ref.replace(/^record:/, "");
    if (recordsById.has(ref) || recordsById.has(strippedRecordId)) {
      const rec = recordsById.get(ref) ?? recordsById.get(strippedRecordId)!;
      return {
        ref,
        status: "in_run",
        target_type: "record",
        target_id: rec.id,
      };
    }

    const strippedArtVersion = ref.replace(/^artifact:/, "");
    if (artifactsByVersion.has(ref) || artifactsByVersion.has(strippedArtVersion)) {
      const art = artifactsByVersion.get(ref) ?? artifactsByVersion.get(strippedArtVersion)!;
      return {
        ref,
        status: art.isStale ? "stale" : "in_run",
        target_type: "artifact",
        target_id: art.artifact_id,
        producer_agent_id: art.producer_agent_id,
        note: art.isStale ? "Referenced version is superseded by a newer version." : undefined,
      };
    }

    return {
      ref,
      status: "unresolved",
      note: `Reference "${ref}" does not resolve to an in-run artifact, tool, test, or record.`,
    };
  }

  return {
    runId,
    artifact,
    artifactsById,
    artifactsByVersion,
    latestArtifactByName,
    toolsById,
    toolsByAgent,
    validationTools,
    testsById,
    testsByArtifact,
    passedTests,
    failedTests,
    recordsById,
    producerOutputsByAgent,
    handoffsById,
    handoffsBySender,
    resolveReference,
  };
}
