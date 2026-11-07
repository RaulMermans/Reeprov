# KARMA POLICE — H2-B limitations

## Machine

This session did not run on the GMKtec EVO X3. It ran in a KVM guest with 4 virtual CPUs and no usable GPU. Ollama used its CPU backend. A result here does not transfer to the EVO X3's GPU, memory, or model choice. `size_vram` was non-zero in `/api/ps` while the daemon log said no usable GPU was found. Those two facts are both recorded. The vram field is not treated as acceleration.

## Sample and model

Three live episodes, one tool smoke, and one offline re-run are the whole live study. `qwen2.5:7b` at temperature 0 and seed 8841 is one local model configuration. It is not a sample of production traffic, and it is not a comparison across model families.

The customer prompts were fixed by the experiment. The agent texts and tool selections were not. In every live episode the order specialist answered from `check_order_status` and did not call `handoff_to_triage`, including when the customer asked for that handoff and the model said, in prose, that it would hand the case back. A narrated handoff is not a framework handoff.

## The intervention is not a natural failure

The false sentence was inserted by the research controller inside `HandoffAgentExecutor._broadcast_messages`. The producer message and the tool result were left as executed. Karma Police saw the producer text and the delivered text differ. That shows the capture and the mismatch check on this trace. It does not show that Microsoft Agent Framework, or this model, spontaneously contradicted the tool.

No receiving agent took a turn after the mutated broadcast. `process_refund` did not run. The H2 offline result, where the scripted triage and refund agents acted on the mutated sentence and called `process_refund`, did not recur here. The offline path still produces that refund when the deterministic client is used. The live path stopped before a receiver existed.

The canonical target `unconsumed_broadcast` means the mutation was passed to the framework broadcast and no later agent turn was observed. It is not an identifier of `triage_agent` or `refund_agent` consuming the false sentence.

## Detector behavior on live wording

The frozen resolver abstained on "scheduled to ship" against the tool sentence "will ship", and it contradicted "expected to ship" plus "has not failed" against the same tool sentence. Those are lexical-boundary outcomes. The live oracle counted the anchor phrases as `supported`. Karma Police's false contradiction on the follow-up is a real precision error on this trace. The detector was not edited to remove it.

The live oracle is a small lexical rule over one sandbox sentence. It is not a general entailment judge. Negation such as "not failed" is excluded from the failure pattern because a first scoring pass treated the substring `failed` as a contradiction. That correction was made before treating the follow-up numbers as final, and it is recorded in the protocol. It does not change the offline H2 oracle.

## Capture

Tool-only handoffs from `triage_agent` have an empty text payload. The adapter used to fill that gap with the sentence "Handoff from triage_agent to order_agent". That sentence was not model output. It was removed for `live_llm`. Empty delivered text stays empty.

Handoff tool calls still surface as `Middleware terminated execution` in the raw tool record. That is the framework short-circuit also seen in the offline observer. The canonical tool row is `completed` with `handoff_short_circuit`, which matches the offline adapter. The raw error string is kept in the observation file.

Token totals are sums of provider-reported call totals. They are not a tokenizer re-count. Local cost is null, not zero dollars.

## What is reproducible from the repository alone

The code on `research/h2b-live-llm-traces`, the pinned Agent Framework commit, and the commands in the results note can repeat the offline path without a model. Repeating the live numbers requires the same Ollama build, the same `qwen2.5:7b` digest (`845dbda0ea48ed749caafd9e6037047aa19acfcfd82e704d7ca97d631a0b697e`), and the same request bounds. Temperature 0 and a seed make the decoding deterministic only for that runtime. They do not make the trace a fixture. The raw observation files are local and gitignored. The checked-in H2 and H3 artifacts do not contain these episodes.

## What this does not justify

It does not justify a paper subsection that says a live model reproduced the H2 unauthorized refund. It does justify a short feasibility note: a local model can drive the unmodified sample, REEPROV can record the HTTP calls and the sandbox tool, and the frozen mismatch check can see a controller-injected broadcast that no downstream agent consumed. Sixteen further episodes were not run, and no significance claim is available.
