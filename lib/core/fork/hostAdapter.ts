/**
 * Resumable Host Adapter Contract & Reference Implementation.
 *
 * Defines the contract through which an application host mounts a restored checkpoint
 * and resumes execution under controlled dependency policies.
 *
 * Invariant:
 * AgentPulse does not attempt OS/process memory time-travel.
 * The application host is responsible for executing its workflow from the resumed step.
 */

import type { CheckpointReference } from "../contracts/lineage";
import type { ReplayHostDependencies } from "../replay/hostAdapter";

export interface ResumableHostParams<TState = Record<string, unknown>> {
  state: TState;
  checkpoint: CheckpointReference;
  resumeStepIndex: number;
  boundaryCursor: number;
}

export interface ExecuteFromParams<TState = Record<string, unknown>> {
  stepIndex: number;
  state: TState;
  dependencies: ReplayHostDependencies;
  toolOverrides?: Map<string, unknown>;
  modelOverrides?: Map<string, unknown>;
  promptOverrides?: Map<string, string>;
}

export interface ResumableHostAdapter<TState = Record<string, unknown>, TOutput = unknown> {
  initializeFromCheckpoint(params: ResumableHostParams<TState>): Promise<void>;
  executeFrom(params: ExecuteFromParams<TState>): Promise<TOutput>;
  finalize(output: TOutput): Promise<void>;
  getState(): TState;
  getFinalOutput(): TOutput | undefined;
  supportsResume(resumeStepIndex: number): boolean;
}

/**
 * Customer Support Triage Resumable Host Adapter.
 *
 * Reference implementation for the Customer Support vertical slice:
 * Step 0: planning
 * Step 1: policy_retrieval
 * Step 2: account_lookup
 * Step 3: synthesis
 */
export class CustomerSupportResumableHostAdapter
  implements ResumableHostAdapter<Record<string, unknown>, string>
{
  private state: Record<string, unknown> = {};
  private finalOutput: string | undefined;
  private checkpoint?: CheckpointReference;
  private resumeStepIndex = 0;

  async initializeFromCheckpoint(params: ResumableHostParams<Record<string, unknown>>): Promise<void> {
    this.state = structuredClone(params.state);
    this.checkpoint = params.checkpoint;
    this.resumeStepIndex = params.resumeStepIndex;
  }

  supportsResume(resumeStepIndex: number): boolean {
    return resumeStepIndex >= 0 && resumeStepIndex <= 3;
  }

  getState(): Record<string, unknown> {
    return structuredClone(this.state);
  }

  getFinalOutput(): string | undefined {
    return this.finalOutput;
  }

  async finalize(output: string): Promise<void> {
    this.finalOutput = output;
  }

  async executeFrom(params: ExecuteFromParams<Record<string, unknown>>): Promise<string> {
    const { stepIndex, dependencies, toolOverrides } = params;
    this.state = structuredClone(params.state);

    // Step 0: Planning (only if resuming from start)
    if (stepIndex === 0) {
      await dependencies.callModel({
        model: "claude-3-5-sonnet",
        provider: "anthropic",
        prompt: "User query: \"What is customer cus_1001's current balance and our refund policy?\". Decide next steps.",
        tools: [{ name: "search_policy" }, { name: "get_customer_account" }],
      });
      this.state.phase = "planning";
    }

    // Step 1: Policy Retrieval (only if resuming at or before step 1)
    if (stepIndex <= 1) {
      await dependencies.callRetrieval({
        service: "pinecone_kb",
        query: "refund policy and eligibility criteria",
      });
      await dependencies.callModel({
        model: "claude-3-5-sonnet",
        provider: "anthropic",
        prompt: "Policy retrieved: \"Full refunds are eligible within 30 days of purchase upon verification.\". Now lookup customer details for user in query \"What is customer cus_1001's current balance and our refund policy?\".",
      });
      this.state.phase = "retrieval";
      this.state.policyFound = true;
    }

    // Step 2: Account Lookup (resumed from checkpoint after policy retrieval)
    if (stepIndex <= 2) {
      let accountData: any;

      if (toolOverrides?.has("get_customer_account")) {
        accountData = toolOverrides.get("get_customer_account");
      } else if (toolOverrides?.has("tool:get_customer_account")) {
        accountData = toolOverrides.get("tool:get_customer_account");
      } else {
        accountData = await dependencies.callTool({
          name: "get_customer_account",
          args: { customerId: "cus_1001" },
        });
      }

      this.state.phase = "account_lookup";
      this.state.accountDetails = accountData;
    }

    // Step 3: Synthesis
    if (stepIndex <= 3) {
      const balance =
        (this.state.accountDetails as any)?.balance ??
        (this.state.account_balance as any) ??
        150;

      let answer = `Your account cus_1001 balance is ${balance} USD. Per company policy, full refunds are eligible within 30 days.`;

      // Check for VIP state mutation
      const isVip =
        (this.state.customer as any)?.vip === true ||
        this.state.vip === true ||
        (this.state.accountDetails as any)?.vip === true;

      if (isVip) {
        answer += " [VIP priority account]";
      }

      this.state.phase = "synthesis";
      this.state.finalAnswer = answer;
      await this.finalize(answer);
      return answer;
    }

    const fallbackAnswer = String(this.state.finalAnswer ?? "Completed triage.");
    await this.finalize(fallbackAnswer);
    return fallbackAnswer;
  }
}
