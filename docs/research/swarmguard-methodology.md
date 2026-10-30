# SwarmGuard Experimental Protocol (frozen for P3)

## Study purpose

Test the falsifiable hypothesis:

> Cross-agent evidence verification improves detection and attribution of unsupported claims compared with conventional per-agent and pooled-event monitoring, especially when evidence is incomplete, stale, or contradictory.

This is a hypothesis, not a result. P3 does not evaluate SwarmGuard.

## Experimental variables

Independent:

- Domain (software-engineering, investigation)
- Content variant (workspace/fixture contents)
- Injection type or control
- Target agent / handoff location
- Execution mode (`offline_fixture` for the frozen benchmark; `live_llm` only for provider smoke)

Dependent (scored in H2, not here):

- Claim classification (supported / contradicted / unverified)
- Observable originating-agent identification
- Observable event or handoff identification
- Latency and, when live, token cost

Causal root-cause identification is scored separately and is not required of the frozen baselines.

## Agent roles

Software engineering: coder → reviewer → release-decision.

Investigation: investigator → validator → decision.

The experimental controller owns routing, tools, injection, and ground truth. Agents own structured judgments. Reeprov owns capture.

## Models and configurations

Offline benchmark: recorded fixtures (`recorded-fixture`). Never labeled `live_llm`.

Live smoke (optional): `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, model `REEPROV_P2_MODEL` (default `gpt-4o-mini` or `claude-3-5-haiku-latest`), budgets in `DEFAULT_BUDGET`.

## Baseline definitions (frozen)

- **A. `baseline.per_agent.v1`**: inspects each agent's own tools/artifacts. No cross-agent resolution. No handoff-aware provenance.
- **B. `baseline.pooled_event.v1`**: simple pooled event/status rules over the whole run. No claim-to-evidence graph.

Both consume only detector-visible evidence and emit `reeprov.swarmguard_testbed.monitor_result.v1`.

## Failure injection

Controller-applied, never described in detector-visible prompts:

| Type | Delivered effect |
|---|---|
| `incorrect_assertion` | Assertion claim replaced after the raw model turn is captured |
| `missing_evidence` | Handoff evidence refs stripped |
| `stale_evidence` | Handoff cites previous artifact version |
| `cross_run_evidence` | Foreign run-prefixed evidence ref |
| `modified_handoff` | Delivered handoff body field changed |
| `skipped_validation` | Validation tool request removed before execution |

A case is **invalid** if the plan is enabled but nothing is applied, or if the applied mutation is not visible in the canonical export. Incomplete capture (`structure_only`, `omitted`) is incomplete observation, not success.

Controlled injected failures are **not** equivalent to naturally occurring agent failures: they are localized, labeled, and timed by the experimenter. They test whether a monitor can see a known delivered inconsistency, not the incidence of real-world errors.

## Ground-truth construction

Oracle templates are bound to delivered assertion target ids and handoff ids after the run. Labels:

- `supported` — the delivered claim or handoff is actually backed by in-run evidence
- `contradicted` — the delivered content conflicts with observed evidence
- `insufficient_evidence` — the delivered content does not carry resolving evidence

Monitor class `unverified` is the correct prediction for `insufficient_evidence`.

## Dataset

24 cases, 8 development / 16 held-out, two domains. Changing run id or seed without changing content, injection, or fixtures does **not** create a new case. Distinct live executions, fixture replays, and re-evaluations of the same artifact are different sample types.

Held-out oracles must not be used to tune SwarmGuard during H1.

## Metrics

See `src/evaluate.ts`. Zero denominators are reported as `null` with a reason. Missing predictions and invalid monitor output are explicit classes in the confusion matrix.

## Valid vs invalid observations

Valid: injection applied **and** detector-visible export contains the delivered effect **and** capture status is `captured` for the relevant field.

Invalid: injection not applied; mutation not visible; capture omitted/structure-only for the field that should carry the effect.

## Threats to validity

Internal: fixture agents are deterministic and may be easier than live models; injections are single-point; oracle labels are experimenter-constructed.

External: two synthetic domains; no production multi-agent traffic; live models may not request the same tools as fixtures.

Statistical: 24 cases is a compact planning set, not a powered clinical trial. H2 must not overclaim significance.

## Reproduction

```bash
npx tsx research/swarmguard-testbed/scripts/run.ts freeze
npx tsx research/swarmguard-testbed/scripts/run.ts experiment --partition development
npx vitest run research/swarmguard-testbed
```

Record commit SHA, case id, run id, execution mode, and artifact paths. Do not persist API keys.
