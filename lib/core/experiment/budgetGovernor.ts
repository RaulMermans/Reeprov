/**
 * Experiment Budget Governor.
 *
 * Implements deterministic budget enforcement across trials and evaluation passes.
 *
 * Enforces:
 * - max_cost_usd
 * - max_trials
 * - max_model_calls
 * - max_duration_ms
 *
 * Stops execution cleanly with BUDGET_EXCEEDED when limits are reached,
 * preserving completed trials and provenance.
 */

import type { ExperimentBudget } from "../contracts/experiment";

export interface BudgetConsumption {
  cost_usd: number;
  candidate_cost_usd: number;
  grader_cost_usd: number;
  trials_executed: number;
  model_calls_executed: number;
  duration_ms: number;
}

export class ExperimentBudgetGovernor {
  private candidateCostUsd = 0;
  private graderCostUsd = 0;
  private trialsStarted = 0;
  private trialsCompleted = 0;
  private modelCalls = 0;
  private readonly startTime = Date.now();
  private exceededReason?: string;

  constructor(private readonly budget: ExperimentBudget) {}

  /**
   * Checks whether another trial may be started under the configured budget limits.
   */
  canStartTrial(): { allowed: boolean; reason?: string } {
    if (this.exceededReason) {
      return { allowed: false, reason: this.exceededReason };
    }

    if (this.trialsStarted >= this.budget.max_trials) {
      this.exceededReason = `Maximum trials limit reached (${this.budget.max_trials})`;
      return { allowed: false, reason: this.exceededReason };
    }

    const currentTotalCost = this.candidateCostUsd + this.graderCostUsd;
    if (currentTotalCost >= this.budget.max_cost_usd) {
      this.exceededReason = `Cost budget limit reached ($${currentTotalCost.toFixed(4)} >= $${this.budget.max_cost_usd.toFixed(2)})`;
      return { allowed: false, reason: this.exceededReason };
    }

    if (this.modelCalls >= this.budget.max_model_calls) {
      this.exceededReason = `Model calls limit reached (${this.modelCalls} >= ${this.budget.max_model_calls})`;
      return { allowed: false, reason: this.exceededReason };
    }

    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.budget.max_duration_ms) {
      this.exceededReason = `Experiment duration limit reached (${elapsed}ms >= ${this.budget.max_duration_ms}ms)`;
      return { allowed: false, reason: this.exceededReason };
    }

    return { allowed: true };
  }

  recordTrialStart(): void {
    this.trialsStarted++;
  }

  recordTrialCompletion(metrics: {
    candidate_cost: number;
    grader_cost: number;
    model_calls?: number;
  }): void {
    this.trialsCompleted++;
    this.candidateCostUsd += metrics.candidate_cost || 0;
    this.graderCostUsd += metrics.grader_cost || 0;
    this.modelCalls += metrics.model_calls || 0;
  }

  isExceeded(): boolean {
    return !this.canStartTrial().allowed;
  }

  getExceededReason(): string | undefined {
    return this.exceededReason;
  }

  getConsumption(): BudgetConsumption {
    return {
      cost_usd: this.candidateCostUsd + this.graderCostUsd,
      candidate_cost_usd: this.candidateCostUsd,
      grader_cost_usd: this.graderCostUsd,
      trials_executed: this.trialsCompleted,
      model_calls_executed: this.modelCalls,
      duration_ms: Date.now() - this.startTime,
    };
  }
}
