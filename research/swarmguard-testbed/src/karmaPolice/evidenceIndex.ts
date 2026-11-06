/**
 * KARMA POLICE — Cross-Agent Evidence Index.
 *
 * Builds a deterministic, cross-agent index of claims, tools, artifacts,
 * authoritative test outcomes, handoffs, producer snapshots, and reference
 * resolutions from authorized detector evidence.
 */

import type { RunArtifact } from "../../../../lib/core/contracts/runArtifact";
import type { RunEvidenceBundle } from "../../../../lib/core/evidence/exportBundle";
import type { TestResult, VerificationEvent } from "../../../../lib/core/contracts/evidence";
import type { AgentHandoff } from "../../../../lib/core/contracts/handoff";
import type {
  IndexedArtifact,
  IndexedRecord,
  IndexedTool,
  KarmaPoliceEvidenceIndex,
  EvidenceReferenceResolution,
  UpstreamFinding,
} from "./types";

export function isCrossRun(ref: string, runId: string): boolean {
  if (ref.startsWith("run_") && !ref.startsWith(`${runId}:`) && ref.includes(":")) {
    return true;
  }
  return false;
}

function isTrustworthySystemTest(
  test: TestResult,
  verificationEventsByTarget: Map<string, VerificationEvent[]>
): boolean {
  if (
    test.origin !== undefined &&
    test.origin !== "system_recorded" &&
    test.origin !== "externally_observed"
  ) {
    return false;
  }
  if (test.authority !== undefined && test.authority !== "authoritative") {
    return false;
  }

  const linkedEvents = verificationEventsByTarget.get(test.test_id) ?? [];
  for (const ev of linkedEvents) {
    if (ev.origin === "agent_asserted" || ev.origin === "unverified") {
      return false;
    }
    if (ev.authority === "asserted" || ev.authority === "unverified") {
      return false;
    }
  }

  return true;
}

export function buildEvidenceIndex(
  artifact: RunArtifact,
  _bundle?: RunEvidenceBundle
): KarmaPoliceEvidenceIndex {
  const runId = artifact.identity.run_id;

  const artifactsById = new Map<string, IndexedArtifact>();
  const artifactsByVersion = new Map<string, IndexedArtifact>();
  const ambiguousVersions = new Set<string>();
  const latestArtifactByName = new Map<string, IndexedArtifact>();
  const toolsById = new Map<string, IndexedTool>();
  const toolsByCallId = new Map<string, IndexedTool[]>();
  const toolsByAgent = new Map<string, IndexedTool[]>();
  const validationTools: IndexedTool[] = [];
  const testsById = new Map<string, TestResult>();
  const testsByArtifact = new Map<string, TestResult[]>();
  const passedTests: TestResult[] = [];
  const failedTests: TestResult[] = [];
  const recordsById = new Map<string, IndexedRecord>();
  const canonicalRecordsById = new Map<string, IndexedRecord>();
  const producerOutputsByAgent = new Map<string, { output?: unknown; assertions?: unknown[] }>();
  const producerOutputsByStep = new Map<string, { output?: unknown; assertions?: unknown[] }>();
  const ambiguousProducerAgents = new Set<string>();
  const upstreamFindingsById = new Map<string, UpstreamFinding>();
  const ambiguousFindingIds = new Set<string>();
  const handoffsById = new Map<string, AgentHandoff>();
  const handoffsBySender = new Map<string, AgentHandoff[]>();

  function upsertRecord(
    id: string,
    kind: string,
    body?: string,
    timestamp?: string,
    aliasId?: string
  ): void {
    const existing = canonicalRecordsById.get(id) ?? recordsById.get(id);
    const merged: IndexedRecord = {
      id,
      kind: kind || existing?.kind || "system_log",
      body: body !== undefined ? body : existing?.body,
      timestamp: timestamp !== undefined ? timestamp : existing?.timestamp,
    };
    canonicalRecordsById.set(id, merged);
    recordsById.set(id, merged);
    if (aliasId) {
      recordsById.set(aliasId, merged);
    }
  }

  function recordProducerState(
    agentId: string | undefined,
    stepId: string | undefined,
    payload: { output?: unknown; assertions?: unknown[] }
  ): void {
    if (stepId) {
      producerOutputsByStep.set(stepId, payload);
    }
    if (agentId) {
      const prev = producerOutputsByAgent.get(agentId);
      if (prev) {
        const prevSig = JSON.stringify(prev.output ?? null);
        const nextSig = JSON.stringify(payload.output ?? null);
        if (prevSig !== nextSig) {
          ambiguousProducerAgents.add(agentId);
        }
      }
      producerOutputsByAgent.set(agentId, payload);
    }
  }

  // 1. Index Trajectory Steps & Producer Turns
  const stepAgentMap = new Map<string, string>();
  for (const step of artifact.trajectory) {
    if (step.agent_id) {
      stepAgentMap.set(step.step_id, step.agent_id);
    }
  }

  // Model turns serve as fallback when post-step state snapshots are absent
  for (const model of artifact.models ?? []) {
    const agentId = (model.metadata?.["agent_id"] as string | undefined) ?? model.agent_id;
    const modelRecord = model as unknown as Record<string, unknown>;
    if (modelRecord["response"] && typeof modelRecord["response"] === "object") {
      const resp = modelRecord["response"] as Record<string, unknown>;
      recordProducerState(agentId, model.step_id, {
        output: resp["output"],
        assertions: Array.isArray(resp["assertions"]) ? resp["assertions"] : undefined,
      });
    }
  }

  // State snapshots capture canonical post-step producer outputs and delivered assertions
  const agentStepPayloads = new Map<string, Map<string, string>>();
  for (const snapshot of artifact.state ?? []) {
    const data = snapshot.state_data;
    if (data && typeof data === "object") {
      const rec = data as Record<string, unknown>;
      const agentId = typeof rec["agent_id"] === "string" ? rec["agent_id"] : undefined;
      if (!agentId && !snapshot.step_id) continue;
      if (rec["output"] === undefined && rec["delivered_assertions"] === undefined) continue;

      const payload = {
        output: rec["output"],
        assertions: Array.isArray(rec["delivered_assertions"])
          ? (rec["delivered_assertions"] as unknown[])
          : undefined,
      };
      if (snapshot.step_id) {
        producerOutputsByStep.set(snapshot.step_id, payload);
      }
      if (agentId) {
        const stepKey = snapshot.step_id ?? snapshot.snapshot_id;
        const stepMap = agentStepPayloads.get(agentId) ?? new Map<string, string>();
        stepMap.set(stepKey, JSON.stringify(payload));
        agentStepPayloads.set(agentId, stepMap);
        if (new Set(stepMap.values()).size > 1) {
          ambiguousProducerAgents.add(agentId);
        } else {
          ambiguousProducerAgents.delete(agentId);
        }
        producerOutputsByAgent.set(agentId, payload);
      }
    }
  }

  // 2. Index Tools
  for (const tool of artifact.tools) {
    const toolName = tool.tool_name;
    const isCompleted = tool.status === "completed";
    const isVal =
      isCompleted &&
      (toolName.includes("validation") ||
        toolName.includes("validate") ||
        (tool.output !== undefined &&
          typeof tool.output === "object" &&
          tool.output !== null &&
          typeof (tool.output as Record<string, unknown>)["passed"] === "boolean"));

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
    const byCallList = toolsByCallId.get(tool.tool_call_id) ?? [];
    byCallList.push(indexedTool);
    toolsByCallId.set(tool.tool_call_id, byCallList);

    if (tool.agent_id) {
      const list = toolsByAgent.get(tool.agent_id) ?? [];
      list.push(indexedTool);
      toolsByAgent.set(tool.agent_id, list);
    }

    if (isVal) {
      validationTools.push(indexedTool);
    }

    // Extract documentary records from completed read_record / list_records / search_records outputs
    if (isRecReader && isCompleted && tool.output) {
      if (Array.isArray(tool.output)) {
        for (const item of tool.output) {
          if (item && typeof item === "object" && typeof item["id"] === "string") {
            upsertRecord(
              item["id"],
              String(item["kind"] ?? "system_log"),
              typeof item["body"] === "string" ? item["body"] : undefined,
              typeof item["timestamp"] === "string" ? item["timestamp"] : undefined
            );
          }
        }
      } else if (typeof tool.output === "object" && tool.output !== null) {
        const item = tool.output as Record<string, unknown>;
        if (typeof item["id"] === "string") {
          upsertRecord(
            item["id"],
            String(item["kind"] ?? "system_log"),
            typeof item["body"] === "string" ? item["body"] : undefined,
            typeof item["timestamp"] === "string" ? item["timestamp"] : undefined
          );
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
      const match = raw.name.match(/-v(\d+)(?:\.[a-z0-9]+)?$/i);
      if (match?.[1]) {
        version = match[1];
      }
    }

    const groupKey =
      (raw.metadata?.["function_name"] as string | undefined) ??
      raw.name.replace(/-v\d+(?:\.[a-z0-9]+)?$/i, "");

    // Extract body from metadata or uniquely matched completed write_artifact tool call
    let body: unknown = raw.metadata?.["body"];
    if (body === undefined) {
      const exactIdWriter = artifact.tools.find(
        (t) =>
          t.status === "completed" &&
          (t.tool_name.includes("write_artifact") || t.tool_name.includes("artifact")) &&
          (t.output as Record<string, unknown> | undefined)?.["artifact_id"] === raw.artifact_id
      );
      const qualifiedWriter =
        exactIdWriter ??
        artifact.tools.find((t) => {
          if (t.status !== "completed") return false;
          if (!t.tool_name.includes("write_artifact") && !t.tool_name.includes("artifact")) {
            return false;
          }
          const inp = t.input as Record<string, unknown> | undefined;
          const out = t.output as Record<string, unknown> | undefined;
          if (out?.["artifact_id"] && out["artifact_id"] !== raw.artifact_id) return false;
          const verMatches = version !== undefined && String(inp?.["version"] ?? "") === version;
          const nameMatches =
            (raw.name && out?.["path"] === raw.name) ||
            (typeof inp?.["name"] === "string" && inp["name"] === groupKey);
          return verMatches && Boolean(nameMatches);
        });

      if (qualifiedWriter && qualifiedWriter.input && typeof qualifiedWriter.input === "object") {
        const inp = qualifiedWriter.input as Record<string, unknown>;
        body = inp["body"] ?? inp["artifact_body"];
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
      const recBody =
        typeof raw.metadata?.["body"] === "string"
          ? (raw.metadata["body"] as string)
          : typeof body === "string"
            ? body
            : typeof body === "object" &&
                body !== null &&
                typeof (body as Record<string, unknown>)["body"] === "string"
              ? ((body as Record<string, unknown>)["body"] as string)
              : undefined;

      upsertRecord(
        raw.name,
        String(raw.metadata?.["kind"] ?? raw.type.replace("incident_record/", "")),
        recBody,
        typeof raw.metadata?.["timestamp"] === "string"
          ? (raw.metadata["timestamp"] as string)
          : undefined,
        raw.artifact_id
      );
      continue;
    }

    const list = artifactsByNameGroup.get(groupKey) ?? [];
    list.push(indexed);
    artifactsByNameGroup.set(groupKey, list);
  }

  // Detect version collisions across distinct artifact groups or duplicate versions within a group
  const versionGroupMap = new Map<string, Set<string>>();
  const versionCountByGroup = new Map<string, number>();

  for (const [groupKey, list] of artifactsByNameGroup.entries()) {
    for (const art of list) {
      if (art.version) {
        const groups = versionGroupMap.get(art.version) ?? new Set<string>();
        groups.add(groupKey);
        versionGroupMap.set(art.version, groups);

        const gvKey = `${groupKey}:${art.version}`;
        versionCountByGroup.set(gvKey, (versionCountByGroup.get(gvKey) ?? 0) + 1);
      }
    }
  }

  for (const [ver, groups] of versionGroupMap.entries()) {
    const hasIntraGroupDup = Array.from(groups).some(
      (g) => (versionCountByGroup.get(`${g}:${ver}`) ?? 0) > 1
    );
    if (groups.size > 1 || hasIntraGroupDup) {
      ambiguousVersions.add(ver);
      ambiguousVersions.add(`v${ver}`);
      ambiguousVersions.add(`artifact:v${ver}`);
      ambiguousVersions.add(`artifact:${ver}`);
    }
  }

  for (const [gvKey, count] of versionCountByGroup.entries()) {
    if (count > 1) {
      const [groupKey, ver] = gvKey.split(":");
      if (groupKey && ver) {
        ambiguousVersions.add(`${groupKey}:${ver}`);
        ambiguousVersions.add(`${groupKey}:v${ver}`);
        ambiguousVersions.add(`artifact:${groupKey}:${ver}`);
        ambiguousVersions.add(`artifact:${groupKey}:v${ver}`);
      }
    }
  }

  // Determine staleness and index versioned artifacts
  for (const [name, list] of artifactsByNameGroup.entries()) {
    if (list.length === 0) continue;

    if (list.length > 1) {
      list.sort((a, b) => {
        const vA = parseInt(a.version ?? "0", 10);
        const vB = parseInt(b.version ?? "0", 10);
        return vA - vB;
      });
    }

    const latest = list[list.length - 1]!;
    latestArtifactByName.set(name, latest);

    for (let i = 0; i < list.length; i++) {
      const art = list[i]!;
      art.isStale = i < list.length - 1;
      if (art.version) {
        const qualKey = `${name}:${art.version}`;
        if (!ambiguousVersions.has(qualKey)) {
          artifactsByVersion.set(`${name}:${art.version}`, art);
          artifactsByVersion.set(`${name}:v${art.version}`, art);
          artifactsByVersion.set(`artifact:${name}:${art.version}`, art);
          artifactsByVersion.set(`artifact:${name}:v${art.version}`, art);
        }
        artifactsByVersion.set(art.name, art);
        artifactsByVersion.set(`artifact:${art.name}`, art);

        if (!ambiguousVersions.has(art.version)) {
          artifactsByVersion.set(art.version, art);
          artifactsByVersion.set(`v${art.version}`, art);
          artifactsByVersion.set(`artifact:v${art.version}`, art);
          artifactsByVersion.set(`artifact:${art.version}`, art);
        }
      }
    }
  }

  // 4. Index Authoritative System-Recorded Tests Only
  const verificationEventsByTarget = new Map<string, VerificationEvent[]>();
  for (const ev of artifact.evidence?.verification_events ?? []) {
    if (ev.target_id) {
      const list = verificationEventsByTarget.get(ev.target_id) ?? [];
      list.push(ev);
      verificationEventsByTarget.set(ev.target_id, list);
    }
  }

  const tests = artifact.evidence?.test_results ?? [];
  for (const test of tests) {
    if (!isTrustworthySystemTest(test, verificationEventsByTarget)) {
      continue;
    }

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

  // 5. Index Handoffs & Upstream Structured Findings
  for (const handoff of artifact.handoffs ?? []) {
    handoffsById.set(handoff.handoff_id, handoff);
    if (handoff.from_agent_id) {
      const list = handoffsBySender.get(handoff.from_agent_id) ?? [];
      list.push(handoff);
      handoffsBySender.set(handoff.from_agent_id, list);
    }

    if (handoff.payload && typeof handoff.payload === "object") {
      const p = handoff.payload as Record<string, unknown>;
      const out =
        p["output"] && typeof p["output"] === "object"
          ? (p["output"] as Record<string, unknown>)
          : undefined;
      if (out && Array.isArray(out["findings"])) {
        for (const f of out["findings"]) {
          if (f && typeof f === "object" && typeof f["id"] === "string" && typeof f["claim"] === "string") {
            const fid = f["id"];
            const existing = upstreamFindingsById.get(fid);
            if (existing && existing.claim !== f["claim"]) {
              ambiguousFindingIds.add(fid);
            } else {
              upstreamFindingsById.set(fid, {
                id: fid,
                claim: f["claim"],
                record_ids: Array.isArray(f["record_ids"])
                  ? f["record_ids"].filter((x): x is string => typeof x === "string")
                  : [],
                severity: typeof f["severity"] === "string" ? f["severity"] : undefined,
                agent_id: handoff.from_agent_id ?? "unknown",
                handoff_id: handoff.handoff_id,
              });
            }
          }
        }
      }
    }
  }

  const canonicalRecords = Array.from(canonicalRecordsById.values());

  // 6. Reference Resolution Function
  function resolveReference(ref: string): EvidenceReferenceResolution {
    if (!ref || ref.trim().length === 0) {
      return {
        ref,
        status: "malformed",
        note: "Empty reference string.",
      };
    }

    if (isCrossRun(ref, runId)) {
      return {
        ref,
        status: "cross_run",
        note: `Reference "${ref}" is scoped to another execution run.`,
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

    if (ref === "artifact:current" || ref === "current") {
      if (latestArtifactByName.size === 1) {
        const latest = Array.from(latestArtifactByName.values())[0]!;
        return {
          ref,
          status: "in_run",
          target_type: "artifact",
          target_id: latest.artifact_id,
          producer_agent_id: latest.producer_agent_id,
        };
      }
      if (latestArtifactByName.size > 1) {
        return {
          ref,
          status: "unresolved",
          note: `Reference "${ref}" is ambiguous: multiple distinct artifact groups exist.`,
        };
      }
    }

    if (toolsByCallId.has(ref)) {
      const list = toolsByCallId.get(ref)!;
      const tool = list[list.length - 1]!;
      return {
        ref,
        status: "in_run",
        target_type: "tool",
        target_id: tool.tool_call_id,
        producer_agent_id: tool.agent_id,
      };
    }

    if (ref.startsWith("tool:")) {
      const toolName = ref.slice("tool:".length);
      const matching = artifact.tools.filter(
        (t) => t.tool_name === toolName && t.status === "completed"
      );
      if (matching.length === 1) {
        return {
          ref,
          status: "in_run",
          target_type: "tool",
          target_id: matching[0]!.tool_call_id,
          producer_agent_id: matching[0]!.agent_id,
        };
      }
      if (matching.length > 1) {
        return {
          ref,
          status: "unresolved",
          note: `Reference "${ref}" is ambiguous across ${matching.length} invocations of "${toolName}".`,
        };
      }
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

    const strippedArtVersion = ref.replace(/^artifact:/, "");
    if (ambiguousVersions.has(ref) || ambiguousVersions.has(strippedArtVersion)) {
      return {
        ref,
        status: "unresolved",
        note: `Reference "${ref}" is ambiguous: multiple distinct artifacts share version "${strippedArtVersion}". Use qualified reference.`,
      };
    }

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
    ambiguousVersions,
    latestArtifactByName,
    toolsById,
    toolsByCallId,
    toolsByAgent,
    validationTools,
    testsById,
    testsByArtifact,
    passedTests,
    failedTests,
    recordsById,
    canonicalRecords,
    producerOutputsByAgent,
    producerOutputsByStep,
    ambiguousProducerAgents,
    upstreamFindingsById,
    ambiguousFindingIds,
    handoffsById,
    handoffsBySender,
    resolveReference,
  };
}
