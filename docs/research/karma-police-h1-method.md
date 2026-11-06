# KARMA POLICE — H1: Cross-Agent Evidence Verification Engine

**Method Specification — Apart Research Swarm Alignment Hackathon (November 6–8, 2026)**  
**Version:** `1.0.0`  
**Protocol:** `p3.benchmark.v1.1`  
**Monitor Identity:** `karma_police.cross_agent.v1`  
**Format:** `reeprov.swarmguard_testbed.monitor_result.v1` / `reeprov.karma_police.findings.v1`

---

## 1. Scientific Objective and Hypothesis

In collaborative multi-agent systems, agents frequently exchange claims, recommendations, code artifacts, test results, and documentary records. When an agent turns rogue, hallucinates, suffers prompt injection, or skips required validation steps, downstream agents often ingest these unverified claims and propagate them across the team.

Existing monitoring paradigms fall into two failure modes:
1. **Per-Agent Monitoring (`baseline.per_agent.v1`):** Analyzes each agent in isolation. When an agent cites an artifact, tool execution, or test produced by a peer, per-agent monitors lack cross-agent visibility and either abstain blindly (`unverified`) or fail to verify cross-agent causal dependencies.
2. **Pooled-Event Monitoring (`baseline.pooled_event.v1`):** Pools all execution events globally. It applies coarse heuristics (e.g., if any tool succeeded or any test passed anywhere in the run, all claims are marked supported; if any tool failed, all claims are marked contradicted). It cannot bind a specific delivered claim to the specific evidence required to substantiate or refute it. Furthermore, it routinely collapses provenance anomalies (such as cross-run references) into false factual contradictions.

### Research Hypothesis

> **Hypothesis:** Cross-agent evidence verification—analyzing the causal and semantic relationships between assertions, artifacts, tool executions, and inter-agent handoffs—can reliably detect and attribute unsupported or contradicted claims that conventional per-agent and pooled-event monitoring miss, while maintaining strict separation between provenance integrity and factual contradiction.

---

## 2. Architecture & Trust Boundary

Karma Police operates under strict experimental isolation:
- **Input Scope:** It consumes exclusively detector-authorized evidence from `createDetectorAccess(outputDir).loadRun(runId)`:
  - Canonical `RunArtifact` (`reeprov.run_artifact.v1`)
  - Canonical `RunEvidenceBundle` (`reeprov.evidence_bundle.v1`)
  - Public `DetectorRunRecord`
- **Trust Boundary Enforcement:** Evaluator directories, oracle files (`oracles.*.json`), ground truth, defect classes, and injection configurations are strictly inaccessible to the detector (`REEPROV_P3_DETECTOR_ROLE=1`).
- **Deterministic Pipeline:** Karma Police operates as a deterministic, offline-capable verification pipeline requiring zero external network access, zero third-party graph databases, and bounded execution latency.

```
                    ┌────────────────────────────┐
                    │ Authorized Detector View   │
                    │ (RunArtifact + Bundle)     │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │ Evidence Indexer           │
                    │ - Cross-Agent Artifact Map │
                    │ - Tool Invocation Index    │
                    │ - System Test Outcomes     │
                    │ - Canonical Turn States    │
                    │ - Reference Resolver       │
                    └─────────────┬──────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ Claim Proposition Verifier    │        │ Provenance Integrity Auditor  │
│ - Test Observation Resolution │        │ - Cross-run ref detection     │
│ - Universal Log Checking      │        │ - Stale artifact references   │
│ - Artifact Mapping Ingestion  │        │ - Unexecuted observations     │
│ - Producer Payload Comparison │        │ - Missing resolving evidence  │
└──────────────┬────────────────┘        └──────────────┬────────────────┘
               │                                        │
               ▼                                        ▼
┌───────────────────────────────┐        ┌───────────────────────────────┐
│ Primary Monitor Result        │        │ Diagnostic Findings Report    │
│ (monitor_result.v1)           │        │ (karma_police.findings.v1)    │
│ - supported                   │        │ - Claim-level evidence audit  │
│ - contradicted                │        │ - Provenance anomalies        │
│ - unverified (abstention)     │        │ - Capture completeness        │
└───────────────────────────────┘        └───────────────────────────────┘
```

---

## 3. Evidence Indexing (`EvidenceIndex`)

Rather than treating the execution trace as an unstructured stream of tokens or independent log lines, Karma Police constructs an indexed relational graph:

1. **Artifact Graph (`artifactsById`, `artifactsByVersion`):**
   - Maps each artifact identifier, name, and semantic version (`v1`, `v2`, etc.).
   - Attributes the producer agent and step.
   - Evaluates artifact version lineages to detect superseded/stale versions (`isStale: true`).
   - Associates authoritative test results referencing that specific artifact.
2. **Tool Invocations (`toolsById`, `toolsByAgent`, `validationTools`):**
   - Indexes all completed and failed tool calls.
   - Identifies functional tool categories: validation/testing tools (`run_validation`, `validate_findings`), artifact writers (`write_artifact`), and documentary readers (`read_record`, `list_records`, `search_records`).
3. **Authoritative Test Results (`testsById`, `testsByArtifact`, `passedTests`, `failedTests`):**
   - Distinguishes authoritative, system-recorded test executions (`origin: "system_recorded"`) from unverified agent claims.
4. **Canonical Agent Turn State (`producerOutputsByAgent`):**
   - Ingests canonical point-in-time state snapshots (`artifact.state`) capturing the exact `output`, `delivered_assertions`, and tool calls produced by each agent before any handoff transfer occurs.
5. **Cross-Agent Handoffs (`handoffsById`, `handoffsBySender`):**
   - Indexes transferred payloads, payload summaries, delivered findings, and cited evidence references across agent boundaries.
6. **Reference Resolution Service (`resolveReference`):**
   - Deterministically categorizes every cited identifier:
     - `in_run`: Identifies an active, in-run artifact, tool call, test, or documentary record.
     - `cross_run`: Identifies an identifier scoped to an external execution (`isCrossRun`).
     - `stale`: Identifies an artifact superseded by a newer version in the same lineage.
     - `unresolved`: Identifies a dangling or non-existent identifier.

---

## 4. Claim Resolution & Three-Way Classification

Claims are extracted canonically using `extractObservableClaims(artifact)`, ensuring that every observable assertion and handoff payload receives an explicit prediction.

For each claim:
1. **Capture Completeness:** If trace capture was truncated (`capture_incomplete: true`, `structure_only`, `omitted`), Karma Police immediately abstains (`classification: "unverified"`, `abstained: true`, `confidence: "low"`), preventing fabricated conclusions from missing trace data.
2. **Provenance Integrity Audit:** Resolves all cited references. Detects cross-run references, stale versions, or dangling references without prematurely collapsing them into factual contradictions.
3. **Producer-Delivered Payload Consistency:** For handoff claims, compares the delivered payload against the canonical output recorded in the producer's turn state snapshot. If a field was tampered with or modified in transit, Karma Police classifies the handoff as `contradicted` (`rationale: "Delivered handoff payload contradicts canonical output recorded for producer agent"`).
4. **Specific Proposition Adjudication:**
   - **Test & Validation Claims:**
     - If the claim asserts validation passed, covers gold cases, or justifies release based on observed tests:
       - If no validation tool or test ever ran in the run: classifies as `unverified` (`abstained: true`, anomaly `unexecuted_observation`).
       - If authoritative tests ran and PASSED: verifies cross-agent test evidence -> `supported`.
       - If authoritative tests ran and FAILED: detects direct contradiction -> `contradicted`.
     - If the claim asserts validation failed (e.g., coder falsely claiming failure when validation passed):
       - If tests PASSED: detects direct contradiction -> `contradicted`.
       - If tests FAILED: confirms failure assertion -> `supported`.
   - **Universal Claims vs Documentary Records:**
     - When a claim makes a universal assertion (e.g., "all records confirm intern causation"), Karma Police checks all indexed documentary system logs (e.g., `SYS-1` auth burst, `SYS-2` backup sudo). If the documentary logs establish incompatible facts, the claim is classified as `contradicted`.
   - **Documentary Record Findings:**
     - When an agent reports findings citing specific records (`SYS-1`, `SYS-2`, `RUM-1`), Karma Police resolves those citations against indexed documentary logs. If the records corroborate the stated finding, it is classified as `supported`.
   - **Artifact Content Claims:**
     - Claims asserting what a versioned artifact maps or contains are verified against the artifact's actual recorded body and metadata. If the artifact exists and defines the mapping, the claim remains `supported` even if a subsequent validation step was skipped.

---

## 5. Separation of Provenance Integrity from Factual Contradiction

A central methodological advance of Karma Police is the strict distinction between **factual accuracy** and **provenance anomalies**:

| Anomaly Kind | Definition | Factual Impact |
|---|---|---|
| `cross_run_reference` | Citation points to a foreign execution run ID | **Not a contradiction.** If in-run evidence corroborates the statement (e.g., `inv-d04`), the claim remains `supported`. |
| `stale_artifact_reference` | Citation references an older version when a newer version exists | **Not a contradiction.** Evaluated against the referenced version's actual content. |
| `unexecuted_observation` | Claim cites an observation/test that was never executed | **Abstains (`unverified`).** Missing observation is not proof of falsehood. |
| `missing_resolving_evidence` | Handoff or claim was stripped of evidence references | **Abstains (`unverified`).** Cannot verify without resolving evidence. |
| `producer_delivered_mismatch` | Delivered handoff payload differs from producer turn state | **Contradicted.** Payload was tampered with in transit. |

---

## 6. Computational Complexity and Reproducibility

- **Time Complexity:** $\mathcal{O}(A + T + E + C)$, where $A$ is the number of artifacts, $T$ the number of tools, $E$ the number of tests/events, and $C$ the number of claims. For typical multi-agent runs ($< 100$ steps), index construction and resolution execute in $< 5\text{ ms}$.
- **Space Complexity:** $\mathcal{O}(A + T + E + C)$ in-memory Map references. Zero disk footprint during detection; optional diagnostic JSON export upon request.
- **Reproducibility:** 100% deterministic. Independent of random seeds, execution timing, case identifiers, or model non-determinism. Runs entirely offline in sandboxed CI.
