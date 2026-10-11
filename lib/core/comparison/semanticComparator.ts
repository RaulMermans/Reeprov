/**
 * Semantic Text Comparator.
 *
 * Implements Layer 2 semantic evaluation of unstructured text (model outputs,
 * plans, review narratives, final answers).
 *
 * Requirements:
 * - Exact/hash check precedes semantic evaluation.
 * - Offline deterministic default comparator executes without external API dependencies.
 * - Pluggable evaluator interface supports LLM-assisted adapters.
 * - Degrades gracefully on failure without breaking comparison generation.
 * - Semantic evaluator can NEVER override deterministic Layer 1 facts.
 */

import { hashPayload } from "../capture/hashing";
import type {
  SemanticComparator,
  SemanticComparisonRequest,
  SemanticComparisonResult,
  SemanticRelation,
} from "../contracts/comparison";

export class DefaultSemanticComparator implements SemanticComparator {
  public readonly name = "agentpulse-deterministic-evaluator";
  public readonly version = "1.0.0";

  async compareText(request: SemanticComparisonRequest): Promise<SemanticComparisonResult> {
    const { text_a, text_b } = request;

    // 1. Exact match / hash check
    if (text_a === text_b || hashPayload(text_a) === hashPayload(text_b)) {
      return {
        semantic_relation: "EQUIVALENT",
        similarity: 1.0,
        material_difference: false,
        summary: "Texts are bit-for-bit identical.",
        confidence: 1.0,
        evaluator_name: this.name,
        evaluator_version: this.version,
      };
    }

    // 2. Normalized whitespace & casing match
    const normA = text_a.trim().toLowerCase().replace(/\s+/g, " ");
    const normB = text_b.trim().toLowerCase().replace(/\s+/g, " ");

    if (normA === normB) {
      return {
        semantic_relation: "PARAPHRASE",
        similarity: 0.99,
        material_difference: false,
        summary: "Texts differ only in formatting/whitespace.",
        confidence: 0.98,
        evaluator_name: this.name,
        evaluator_version: this.version,
      };
    }

    // 3. Token-level overlap (Jaccard similarity on alphanumeric tokens)
    const tokensA = new Set(normA.match(/[a-z0-9_]+/g) ?? []);
    const tokensB = new Set(normB.match(/[a-z0-9_]+/g) ?? []);

    if (tokensA.size === 0 && tokensB.size === 0) {
      return {
        semantic_relation: "EQUIVALENT",
        similarity: 1.0,
        material_difference: false,
        summary: "Both texts are empty.",
        confidence: 1.0,
        evaluator_name: this.name,
        evaluator_version: this.version,
      };
    }

    let intersectionCount = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersectionCount++;
    }

    const unionCount = new Set([...tokensA, ...tokensB]).size;
    const jaccard = unionCount > 0 ? intersectionCount / unionCount : 0;
    const similarity = Math.round(jaccard * 100) / 100;

    let relation: SemanticRelation = "DIVERGENT";
    let materialDiff = true;
    let summary = "Texts exhibit material differences.";

    if (similarity >= 0.85) {
      relation = "REFINED";
      materialDiff = false;
      summary = `High conceptual overlap (${Math.round(similarity * 100)}% token agreement). Minor wording refinement.`;
    } else if (similarity >= 0.65) {
      relation = "PARAPHRASE";
      materialDiff = false;
      summary = `Moderate conceptual overlap (${Math.round(similarity * 100)}% token agreement). Paraphrase or elaboration.`;
    } else if (similarity <= 0.25) {
      relation = "DIVERGENT";
      materialDiff = true;
      summary = `Low conceptual overlap (${Math.round(similarity * 100)}% token agreement). Significant divergence in meaning.`;
    } else {
      relation = "DIVERGENT";
      materialDiff = true;
      summary = `Distinct semantics (${Math.round(similarity * 100)}% token agreement).`;
    }

    return {
      semantic_relation: relation,
      similarity,
      material_difference: materialDiff,
      summary,
      confidence: 0.85,
      evaluator_name: this.name,
      evaluator_version: this.version,
    };
  }
}

/**
 * Executes a semantic comparison safely with fallback to UNAVAILABLE if the comparator fails.
 */
export async function safeSemanticCompare(
  comparator: SemanticComparator,
  request: SemanticComparisonRequest
): Promise<SemanticComparisonResult> {
  try {
    return await comparator.compareText(request);
  } catch (err) {
    return {
      semantic_relation: "UNAVAILABLE",
      similarity: 0,
      material_difference: true,
      summary: `Semantic evaluator failed: ${(err as Error).message}. Degraded to structural only.`,
      confidence: 0,
      evaluator_name: "fallback-error-boundary",
      evaluator_version: "1.0.0",
    };
  }
}
