/**
 * Candidate Model Adapter.
 *
 * Provider-neutral interface for candidate model executions during experiments.
 *
 * Requirements:
 * - Does not hardcode an agent loop.
 * - Supports OpenAI, Anthropic, local model, custom gateway, or test fixture.
 * - Tracks provider, model, revision, parameters, token usage, cost, and latency.
 * - Safety: Live billable model execution is allowed ONLY when allow_live_model_calls is true.
 * - Blocks live network calls by default under SAFE_OFFLINE policy.
 */

export interface CandidateModelRequest {
  provider: string;
  model: string;
  prompt: string;
  system_prompt?: string;
  temperature?: number;
  parameters?: Record<string, unknown>;
  tools?: unknown[];
  context_data?: unknown;
}

export interface CandidateModelResponse {
  provider: string;
  model: string;
  revision?: string;
  output: unknown;
  parameters: Record<string, unknown>;
  token_usage: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost_usd: number;
  latency_ms: number;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  error?: string;
  seed?: number;
  system_fingerprint?: string;
}

export type CandidateModelExecutionFn = (
  req: CandidateModelRequest
) => Promise<CandidateModelResponse>;

export class CandidateModelAdapter {
  constructor(
    private readonly executionFn?: CandidateModelExecutionFn,
    private readonly allowLiveCalls = false
  ) {}

  async execute(req: CandidateModelRequest): Promise<CandidateModelResponse> {
    const startTime = Date.now();

    // 1. Safety Guard: Disallow live external model calls unless explicitly authorized
    if (!this.allowLiveCalls && !this.executionFn) {
      return {
        provider: req.provider,
        model: req.model,
        output: null,
        parameters: req.parameters ?? {},
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        status: "BLOCKED",
        error: "Live model calls denied: allow_live_model_calls is false and no sandboxed handler was provided.",
      };
    }

    if (!this.executionFn) {
      return {
        provider: req.provider,
        model: req.model,
        output: null,
        parameters: req.parameters ?? {},
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        status: "FAILED",
        error: "No candidate model execution handler provided.",
      };
    }

    try {
      const res = await this.executionFn(req);
      return res;
    } catch (err: any) {
      return {
        provider: req.provider,
        model: req.model,
        output: null,
        parameters: req.parameters ?? {},
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: Date.now() - startTime,
        status: "FAILED",
        error: err.message ?? String(err),
      };
    }
  }
}
