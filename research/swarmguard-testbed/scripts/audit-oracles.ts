/**
 * Evaluator-only oracle audit. Prints delivered claims vs labels.
 * Not a detector interface.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listBenchmarkCases } from "../src/benchmark";
import { runBenchmarkCase } from "../src/experiment";
import { extractObservableClaims } from "../src/baselines/schema";
import { HELDOUT_ALLOW_ENV } from "../src/heldoutAccess";

process.env[HELDOUT_ALLOW_ENV] = "1";

const outDir = join(process.cwd(), "research/swarmguard-testbed/.output/oracle-audit");

async function main() {
  await mkdir(outDir, { recursive: true });
  const cases = listBenchmarkCases();
  const reports = [];
  for (const spec of cases) {
    const result = await runBenchmarkCase({
      caseId: spec.case_id,
      outputDir: outDir,
      persist: false,
      runId: `audit_${spec.case_id}`,
    });
    const artifact = result.artifact;
    const assertions = (artifact.evidence?.verification_events ?? [])
      .filter((e) => e.origin === "agent_asserted")
      .map((e) => ({
        target_id: e.target_id,
        actor: e.actor,
        claim: e.details?.["claim"],
        evidence_refs: e.evidence_refs,
        capture_status: e.details?.["capture_status"],
      }));
    const tools = artifact.tools.map((t) => ({
      agent_id: t.agent_id,
      tool_name: t.tool_name,
      status: t.status,
      output: t.output,
      error: t.error,
    }));
    const tests = artifact.evidence?.test_results ?? [];
    const handoffs = (artifact.handoffs ?? []).map((h) => ({
      handoff_id: h.handoff_id,
      from: h.from_agent_id,
      to: h.to_agent_id,
      summary: h.payload_summary,
      evidence_refs: h.evidence_refs,
      artifact_refs: h.artifact_refs,
      payload: h.payload,
      capture: h.payload_capture_status,
    }));
    const claims = extractObservableClaims(artifact);
    const row = {
      case_id: spec.case_id,
      partition: spec.partition,
      domain_id: spec.domain_id,
      injection: spec.injection,
      notes: spec.notes,
      validity: result.ground_truth.experimental_validity,
      injections_applied: result.ground_truth.injections.map((i) => ({
        type: i.type,
        actual: i.actual_modification,
      })),
      assertions,
      tools,
      tests,
      handoffs,
      oracle: result.ground_truth.oracle_labels,
      observable_claim_ids: claims.map((c) => c.claim_id),
    };
    reports.push(row);
    console.log(`\n==== ${spec.case_id} (${spec.partition}) validity=${row.validity} inj=${spec.injection.type ?? "control"} ====`);
    for (const o of row.oracle) {
      const delivered =
        o.event_kind === "assertion"
          ? assertions.find((a) => a.target_id === o.claim_id) ??
            assertions.filter((a) => a.actor === o.agent_id)[0]
          : handoffs.find((h) => `handoff:${h.handoff_id}` === o.claim_id) ??
            handoffs.find((h) => h.from === o.agent_id);
      console.log(
        JSON.stringify({
          label: o.label,
          kind: o.event_kind,
          agent: o.agent_id,
          just: o.justification,
          delivered:
            o.event_kind === "assertion"
              ? { claim: (delivered as typeof assertions[0] | undefined)?.claim, refs: (delivered as typeof assertions[0] | undefined)?.evidence_refs }
              : {
                  summary: (delivered as typeof handoffs[0] | undefined)?.summary,
                  evidence_refs: (delivered as typeof handoffs[0] | undefined)?.evidence_refs,
                  artifact_refs: (delivered as typeof handoffs[0] | undefined)?.artifact_refs,
                  payload: (delivered as typeof handoffs[0] | undefined)?.payload,
                },
        })
      );
    }
    const valTools = tools.filter((t) => t.tool_name === "run_validation" || t.tool_name === "validate_findings");
    if (valTools.length) console.log("validation_tools", JSON.stringify(valTools.map((t) => ({ name: t.tool_name, status: t.status, output: t.output }))));
    else console.log("validation_tools: NONE");
    console.log("tests", JSON.stringify(tests.map((t) => ({ name: t.name, status: t.status }))));
  }
  await writeFile(join(outDir, "audit.json"), JSON.stringify(reports, null, 2));
  console.log(`\nWrote ${reports.length} cases to ${join(outDir, "audit.json")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
