# Reeprov Semantic Comparison (Layer 2)

## 1. Role in the Comparison Pipeline

Layer 1 establishes deterministic facts. Layer 2 interprets natural language and semantic differences across:
- Model output text
- Reasoning summaries
- Plan descriptions
- Retrieved snippet content
- Final user answers

## 2. Invariants & Boundaries

1. **Layer 1 is Sovereign**: A semantic comparator cannot alter step alignment, invalidate tool call differences, or change test pass/fail results.
2. **Deterministic Fallback**: If an external LLM is not configured, unavailable, or disabled, `DefaultSemanticComparator` runs offline using deterministic heuristics.
3. **Safe Error Handling**: `safeSemanticCompare()` wraps all semantic comparisons in an error boundary. If a comparator fails or times out, it gracefully falls back to `UNAVAILABLE` without breaking the overall comparison report.

## 3. Offline Heuristic Engine (`DefaultSemanticComparator`)

The offline comparator provides deterministic semantic evaluation:
1. **Exact Hash Match**: If trimmed text or SHA-256 hash matches -> `EQUIVALENT` (similarity 1.0).
2. **Normalized Paraphrase Check**: Lowercasing, punctuation stripping, whitespace normalization -> `PARAPHRASE` (similarity 0.95+).
3. **Token Jaccard & Containment**: Word-set token overlap calculation:
   - Jaccard similarity >= 0.85 -> `PARAPHRASE`
   - Jaccard similarity >= 0.60 or containment >= 0.70 -> `REFINED`
   - Jaccard similarity < 0.60 -> `DIVERGENT`

## 4. Semantic Comparison Contract

```typescript
export interface SemanticComparisonResult {
  dimension: ComparisonDimension;
  subject: string;
  semantic_relation: "EQUIVALENT" | "PARAPHRASE" | "REFINED" | "DIVERGENT" | "UNAVAILABLE";
  similarity_score: number;
  explanation: string;
  divergence_summary?: string;
  comparator_name: string;
}
```
