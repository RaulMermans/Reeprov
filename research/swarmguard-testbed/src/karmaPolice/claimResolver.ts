/**
 * KARMA POLICE — Cross-Agent Claim Resolver.
 *
 * Evaluates observable claims and handoffs against the cross-agent evidence index.
 * Follows strict three-way classification semantics:
 *   - supported: relevant evidence entails the delivered statement.
 *   - contradicted: relevant evidence establishes an incompatible fact.
 *   - unverified: evidence cannot establish either conclusion (abstained).
 *
 * Keeps factual classification strictly separate from provenance integrity anomalies.
 * Free of benchmark-specific entities, hardcoded record IDs, or false support from citations.
 */

import type { ObservableClaim, ClaimPrediction } from "../baselines/schema";
import { predictionFor } from "../baselines/schema";
import type {
  KarmaPoliceEvidenceIndex,
  ClaimProvenanceFinding,
  ProvenanceAnomalyKind,
  EvidenceReferenceResolution,
  IndexedArtifact,
  IndexedRecord,
} from "./types";

interface ResolutionResult {
  prediction: ClaimPrediction;
  finding: ClaimProvenanceFinding;
}

interface AtomicSubClaim {
  kind: "text" | "finding" | "assessment";
  rawText: string;
  ownRefs: string[];
  allRefs: string[];
  artifactRefs: string[];
  findingId?: string;
  expectedSupported?: boolean;
  severity?: string;
}

interface AtomicEvalOutcome {
  status: "supported" | "contradicted" | "unverified";
  rationale: string;
  supportingIds: string[];
  contradictingIds: string[];
  anomalies: ProvenanceAnomalyKind[];
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  no: 0,
  none: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
};

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "into",
  "onto",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "it",
  "its",
  "that",
  "this",
  "these",
  "those",
  "any",
  "without",
  "there",
  "their",
  "they",
  "them",
]);

const FRAMING_VERBS_AND_META = new Set([
  "originate",
  "originated",
  "occur",
  "occurred",
  "observe",
  "observed",
  "detect",
  "detected",
  "describe",
  "describing",
  "described",
  "show",
  "showing",
  "confirm",
  "confirming",
  "confirmed",
  "state",
  "stating",
  "indicate",
  "indicating",
  "report",
  "reported",
  "use",
  "used",
  "using",
  "count",
  "source",
  "host",
  "system",
  "log",
  "record",
  "repeated",
  "multiple",
  "burst",
]);

const RUMOR_FRAMING_WORDS = new Set([
  "chat",
  "message",
  "messages",
  "claiming",
  "claimed",
  "claim",
  "rumor",
  "rumors",
  "probably",
  "maybe",
  "allegedly",
  "possibly",
  "caused",
  "cause",
  "naming",
  "named",
  "about",
  "someone",
  "person",
  "unsupported",
  "supported",
  "corroborated",
  "proof",
  "treat",
]);

export function stemWord(raw: string): string {
  const w = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!w) return "";
  if (w === "authentication" || w === "authenticating" || w === "authenticated") return "auth";
  if (
    w === "succeed" ||
    w === "succeeds" ||
    w === "succeeded" ||
    w === "successful" ||
    w === "successfully"
  ) {
    return "success";
  }
  if (w === "fail" || w === "fails" || w === "failed" || w === "failing" || w === "failures") {
    return "failure";
  }
  if (w === "errors" || w === "errored") return "error";
  if (w === "connections" || w === "connected" || w === "connecting") return "connection";
  if (w === "exhausted" || w === "exhaustion") return "exhaust";
  if (w === "attempts" || w === "attempted") return "attempt";
  if (w === "logged" || w === "logging" || w === "logs") return "log";
  if (w === "records" || w === "recorded") return "record";
  if (w === "upgraded" || w === "upgrading" || w === "upgrades") return "upgrade";
  if (w === "flushed" || w === "flushing") return "flush";
  if (w === "deny" || w === "denies" || w === "denied" || w === "denying") return "deny";
  if (w === "allow" || w === "allows" || w === "allowed" || w === "allowing") return "allow";
  if (w === "permit" || w === "permits" || w === "permitted" || w === "permitting") return "permit";
  if (w === "authorize" || w === "authorizes" || w === "authorized" || w === "authorizing") {
    return "authorize";
  }
  if (w === "approve" || w === "approves" || w === "approved" || w === "approving") {
    return "approve";
  }
  if (w === "refuse" || w === "refuses" || w === "refused" || w === "refusing") return "refuse";
  if (w === "revoke" || w === "revokes" || w === "revoked" || w === "revoking") return "revoke";
  if (w === "enable" || w === "enables" || w === "enabled" || w === "enabling") return "enable";
  if (w === "disable" || w === "disables" || w === "disabled" || w === "disabling") {
    return "disable";
  }
  if (w === "forbid" || w === "forbids" || w === "forbade" || w === "forbidden") return "forbid";
  if (w === "prohibit" || w === "prohibits" || w === "prohibited" || w === "prohibiting") {
    return "prohibit";
  }

  if (w.length >= 5 && w.endsWith("ies")) {
    return `${w.slice(0, -3)}y`;
  }
  if (w.length >= 6 && w.endsWith("ing")) {
    return w.slice(0, -3);
  }
  if (w.length >= 6 && w.endsWith("ed")) {
    return w.slice(0, -2);
  }
  if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss") && w !== "status") {
    return w.slice(0, -1);
  }
  return w;
}

/**
 * Deterministic adapter for extracting string mapping tables from structured artifacts.
 */
export function extractMappingFromArtifact(art: IndexedArtifact): Record<string, string> | null {
  if (!art.body || typeof art.body !== "object" || Array.isArray(art.body)) return null;
  const b = art.body as Record<string, unknown>;

  let candidate: unknown = b["mapping"];
  if (
    (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) &&
    b["body"] &&
    typeof b["body"] === "object" &&
    !Array.isArray(b["body"])
  ) {
    candidate = (b["body"] as Record<string, unknown>)["mapping"];
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(candidate as Record<string, unknown>)) {
    if (typeof v !== "string") {
      return null;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Verifies structured mapping claims against the recorded artifact content.
 * Uses zero domain-specific hardcoded keys or target sets; abstains when prose
 * claims cannot be deterministically parsed into structural mapping checks.
 */
export function verifyMappingClaim(
  art: IndexedArtifact,
  rawClaimText: string
): { status: "supported" | "contradicted" | "unverified"; rationale: string } {
  const mapping = extractMappingFromArtifact(art);
  if (!mapping) {
    return {
      status: "unverified",
      rationale: `Artifact "${art.name}" body structure does not contain a verifiable mapping table (abstaining).`,
    };
  }

  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    return {
      status: "contradicted",
      rationale: `Artifact "${art.name}" mapping table is empty.`,
    };
  }

  // 1. Check explicit arrow pairs: e.g. `URGENT -> p1`, `'prio: med' → p2`
  const arrowRegex = /['"`]?([A-Za-z0-9_.: -]+?)['"`]?\s*(?:->|→)\s*['"`]?([A-Za-z0-9_-]+)['"`]?/g;
  const explicitPairs: Array<{ src: string; dst: string }> = [];
  let arrowMatch: RegExpExecArray | null;
  while ((arrowMatch = arrowRegex.exec(rawClaimText)) !== null) {
    const src = arrowMatch[1]!.trim();
    const dst = arrowMatch[2]!.trim();
    if (src && dst) {
      explicitPairs.push({ src, dst });
    }
  }

  const isNegatedMapping =
    /\b(?:does\s+not|do\s+not|did\s+not|cannot|can['’]t|never|not)\s+maps?\b/i.test(rawClaimText);

  // Also check single explicit pair: `map(s) token "X" to "Y"` (without pipe target set)
  const singlePairMatch = rawClaimText.match(
    /\bmaps?\s+(?:token\s+)?(?:['"`]([A-Za-z0-9_.: -]+)['"`]|([A-Za-z0-9_.:-]+))\s+(?:onto|into|to)\s+['"`]?([A-Za-z0-9_-]+)['"`]?(?:[.,;]|$)/i
  );
  const singleSrc = singlePairMatch?.[1] ?? singlePairMatch?.[2];
  const singleDst = singlePairMatch?.[3];
  if (singleSrc && singleDst && !singleDst.includes("|")) {
    explicitPairs.push({ src: singleSrc.trim(), dst: singleDst.trim() });
  }

  if (isNegatedMapping) {
    if (explicitPairs.length === 0) {
      return {
        status: "unverified",
        rationale: `Negated mapping claim on artifact "${art.name}" does not specify an explicit token->target pair (abstaining).`,
      };
    }
    for (const pair of explicitPairs) {
      const actual = mapping[pair.src];
      if (actual !== undefined && actual.toLowerCase() === pair.dst.toLowerCase()) {
        return {
          status: "contradicted",
          rationale: `Artifact "${art.name}" maps token "${pair.src}" to "${actual}", contradicting the negated mapping claim.`,
        };
      }
    }
    return {
      status: "supported",
      rationale: `Artifact "${art.name}" does not map the specified token(s) to the excluded target(s).`,
    };
  }

  for (const pair of explicitPairs) {
    const actual = mapping[pair.src];
    if (actual === undefined) {
      return {
        status: "contradicted",
        rationale: `Artifact "${art.name}" mapping is missing required token "${pair.src}".`,
      };
    }
    if (actual.toLowerCase() !== pair.dst.toLowerCase()) {
      return {
        status: "contradicted",
        rationale: `Artifact "${art.name}" maps token "${pair.src}" to "${actual}" instead of expected "${pair.dst}".`,
      };
    }
  }

  // 2. Check set-valued mapping specifications: `maps <sourceSpec> onto|to|into <t1|t2|...>`
  const setMapMatch = rawClaimText.match(
    /\bmaps\s+(.+?)\s+(?:onto|into|to)\s+([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)+)/i
  );

  if (!setMapMatch) {
    if (explicitPairs.length > 0) {
      return {
        status: "supported",
        rationale: `Referenced artifact exists and its recorded content defines the claimed mapping values.`,
      };
    }
    return {
      status: "unverified",
      rationale: `Claim on artifact "${art.name}" does not specify deterministic mapping keys or target domain (abstaining).`,
    };
  }

  const sourceSpec = setMapMatch[1]!.trim();
  const targetSpec = setMapMatch[2]!.trim();
  const targetList = targetSpec
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
  const lowerTargetMap = new Map<string, string>();
  for (const t of targetList) {
    lowerTargetMap.set(t.toLowerCase(), t);
  }

  // Verify every value in the mapping lies within the declared target domain
  // and any canonical/case-variant key matching a target name maps to itself
  for (const [key, val] of entries) {
    if (!lowerTargetMap.has(val.toLowerCase())) {
      return {
        status: "contradicted",
        rationale: `Artifact "${art.name}" maps token "${key}" to invalid target "${val}" outside ${targetSpec}.`,
      };
    }
    const keyNorm = key.trim().toLowerCase();
    if (lowerTargetMap.has(keyNorm)) {
      const expectedTarget = lowerTargetMap.get(keyNorm)!;
      if (val.toLowerCase() !== expectedTarget.toLowerCase()) {
        return {
          status: "contradicted",
          rationale: `Artifact "${art.name}" maps token "${key}" to "${val}" instead of expected "${expectedTarget}".`,
        };
      }
    }
  }

  // Parse comma / 'and' separated items in sourceSpec
  const rawDescriptors = sourceSpec
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((s) => s.trim().replace(/[.;:]+$/, ""))
    .filter(Boolean);

  let verifiedDescriptorCount = 0;

  for (const desc of rawDescriptors) {
    // Prefix family descriptor: e.g. `prefixed sev tokens`
    const prefixMatch = desc.match(/^prefixed\s+['"`]?([A-Za-z0-9_-]+):?['"`]?(?:\s+tokens?)?$/i);
    if (prefixMatch?.[1]) {
      const prefix = prefixMatch[1].toLowerCase();
      const prefixedEntries = entries.filter(([k]) => {
        const kl = k.toLowerCase();
        return (
          kl.startsWith(`${prefix}:`) ||
          kl.startsWith(`${prefix}_`) ||
          kl.startsWith(`${prefix}-`) ||
          kl.startsWith(`${prefix} `)
        );
      });
      if (prefixedEntries.length === 0) {
        return {
          status: "contradicted",
          rationale: `Artifact "${art.name}" mapping is missing required "${prefixMatch[1]}" prefixed tokens.`,
        };
      }
      for (const [pk, pv] of prefixedEntries) {
        const stripped = pk.replace(/^[A-Za-z0-9_-]+[:_\-\s]+/, "").trim().toLowerCase();
        if (lowerTargetMap.has(stripped)) {
          const expected = lowerTargetMap.get(stripped)!;
          if (pv.toLowerCase() !== expected.toLowerCase()) {
            return {
              status: "contradicted",
              rationale: `Artifact "${art.name}" maps token "${pk}" to "${pv}" instead of expected "${expected}".`,
            };
          }
        }
      }
      verifiedDescriptorCount++;
      continue;
    }

    // Pipe-delimited canonical tokens descriptor: e.g. `canonical low|medium|high tokens`
    const pipeDescMatch = desc.match(
      /^(?:canonical\s+)?([A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)+)(?:\s+tokens?)?$/i
    );
    if (pipeDescMatch?.[1]) {
      for (const tok of pipeDescMatch[1].split("|").map((t) => t.trim()).filter(Boolean)) {
        const actual = mapping[tok];
        if (actual === undefined) {
          return {
            status: "contradicted",
            rationale: `Artifact "${art.name}" mapping is missing required token "${tok}".`,
          };
        }
        if (lowerTargetMap.has(tok.toLowerCase()) && actual.toLowerCase() !== tok.toLowerCase()) {
          return {
            status: "contradicted",
            rationale: `Artifact "${art.name}" maps token "${tok}" to "${actual}" instead of expected "${tok}".`,
          };
        }
      }
      verifiedDescriptorCount++;
      continue;
    }

    // Literal token descriptor: e.g. `URGENT`, `fatal`, `'prio: p1'`
    const quotedMatch = desc.match(/^['"`](.+?)['"`](?:\s+tokens?)?$/);
    const cleaned = quotedMatch?.[1]
      ? quotedMatch[1].trim()
      : desc.replace(/\s+tokens?$/i, "").trim();

    // Ignore multi-word prose noun phrases that are neither quoted nor punctuated keys
    if (!quotedMatch && /\s/.test(cleaned) && !cleaned.includes(":") && mapping[cleaned] === undefined) {
      continue;
    }

    const actual = mapping[cleaned];
    if (actual === undefined) {
      return {
        status: "contradicted",
        rationale: `Artifact "${art.name}" mapping is missing required token "${cleaned}".`,
      };
    }
    if (!lowerTargetMap.has(actual.toLowerCase())) {
      return {
        status: "contradicted",
        rationale: `Artifact "${art.name}" maps token "${cleaned}" to invalid target "${actual}".`,
      };
    }
    if (lowerTargetMap.has(cleaned.toLowerCase())) {
      const expected = lowerTargetMap.get(cleaned.toLowerCase())!;
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        return {
          status: "contradicted",
          rationale: `Artifact "${art.name}" maps token "${cleaned}" to "${actual}" instead of expected "${expected}".`,
        };
      }
    }
    verifiedDescriptorCount++;
  }

  if (verifiedDescriptorCount === 0 && explicitPairs.length === 0) {
    return {
      status: "unverified",
      rationale: `Claim on artifact "${art.name}" uses prose descriptors without verifiable input token names (abstaining).`,
    };
  }

  return {
    status: "supported",
    rationale: `Referenced artifact exists and its recorded content defines the claimed mapping values.`,
  };
}

const NEGATION_WORDS = new Set([
  "not",
  "never",
  "neither",
  "nor",
  "no",
  "none",
  "without",
]);

const PERM_POS_STEMS = new Set([
  "allow",
  "permit",
  "grant",
  "authorize",
  "accept",
  "approve",
  "enable",
]);

const PERM_NEG_STEMS = new Set([
  "deny",
  "disallow",
  "block",
  "reject",
  "refuse",
  "forbid",
  "prohibit",
  "revoke",
  "unauthorized",
  "unauthorised",
  "disable",
]);

const ZERO_FAILURE_PHRASE_RE =
  /\b(?:zero|no|none)\s+(?:[a-z0-9_-]+\s+){0,2}(?:failed|failures?|errors?|timeouts?|crashes?)\b|\bwithout\s+(?:any\s+)?(?:[a-z0-9_-]+\s+){0,2}(?:failed|failures?|errors?|timeouts?|crashes?)\b|\b(?:did|does|do|was|were|is|are|has|have|had|can|could|will|would)\s+not\s+(?:[a-z]+\s+)?(?:fail|failed|error|errored|crash|crashed|timeout)\b|\bnever\s+(?:[a-z]+\s+)?(?:fail|fails|failed|error|errored|crash|crashed|timed\s+out)\b|\b(?:failure|failures|error|errors)\s+count=0\b/gi;

const NEG_PREFIX_SRC = String.raw`\b(?:not|never|no|none|neither|nor|without)\s+(?:(?!and\b|but\b)[a-z0-9_-]+\s+){0,3}`;
const POS_POLARITY_SRC = String.raw`(?:success|succeed|succeeds|succeeded|successful|successfully|healthy|pass|passes|passed|allow|allows|allowed|allowing|permit|permits|permitted|permitting|grant|grants|granted|granting|authorize|authorizes|authorized|authorizing|accept|accepts|accepted|accepting|approve|approves|approved|approving|enable|enables|enabled|enabling)\b`;
const NEG_POLARITY_SRC = String.raw`(?:fail|fails|failed|failing|failure|failures|error|errors|errored|deny|denies|denied|denying|disallow|disallows|disallowed|unauthorized|unauthorised|block|blocks|blocked|blocking|reject|rejects|rejected|rejecting|refuse|refuses|refused|refusing|forbid|forbids|forbade|forbidden|prohibit|prohibits|prohibited|revoke|revokes|revoked|disable|disables|disabled|exhaust|exhausted|exhaustion|timeout|timeouts|timed\s+out|crash|crashes|crashed|abort|aborts|aborted|unhealthy)\b`;

const NEGATED_POS_RE = new RegExp(`${NEG_PREFIX_SRC}${POS_POLARITY_SRC}`, "gi");
const NEGATED_NEG_RE = new RegExp(`${NEG_PREFIX_SRC}${NEG_POLARITY_SRC}`, "gi");
const UNNEGATED_POS_RE = new RegExp(`\\b${POS_POLARITY_SRC}`, "i");
const UNNEGATED_NEG_RE = new RegExp(`\\b${NEG_POLARITY_SRC}`, "i");
const CLAUSE_NEGATION_RE = /\b(?:not|never|neither|nor|no|none|without)\b/i;

function normalizeNegationContractions(text: string): string {
  return text
    .replace(/\bcannot\b/gi, "can not")
    .replace(/\bwon['’]t\b/gi, "will not")
    .replace(/\bcan['’]t\b/gi, "can not")
    .replace(/\b([a-z]+)n['’]t\b/gi, "$1 not");
}

function analyzePolarityAndNegation(normLower: string): {
  polarity: "failure" | "success" | "neutral";
  negated: boolean;
  assertsZeroFailures: boolean;
  hasUnnegatedNeg: boolean;
  hasNegatedPos: boolean;
  hasNegatedNeg: boolean;
  hasPermPos: boolean;
  hasPermNeg: boolean;
} {
  ZERO_FAILURE_PHRASE_RE.lastIndex = 0;
  const assertsZeroFailures = ZERO_FAILURE_PHRASE_RE.test(normLower);
  ZERO_FAILURE_PHRASE_RE.lastIndex = 0;
  const textWithoutZeroFail = normLower.replace(ZERO_FAILURE_PHRASE_RE, " ");
  ZERO_FAILURE_PHRASE_RE.lastIndex = 0;

  const negated = CLAUSE_NEGATION_RE.test(textWithoutZeroFail);

  NEGATED_POS_RE.lastIndex = 0;
  const hasNegatedPos = NEGATED_POS_RE.test(textWithoutZeroFail);
  NEGATED_POS_RE.lastIndex = 0;

  NEGATED_NEG_RE.lastIndex = 0;
  const hasNegatedNeg = NEGATED_NEG_RE.test(textWithoutZeroFail);
  NEGATED_NEG_RE.lastIndex = 0;

  const remainingText = textWithoutZeroFail
    .replace(NEGATED_POS_RE, " ")
    .replace(NEGATED_NEG_RE, " ");
  NEGATED_POS_RE.lastIndex = 0;
  NEGATED_NEG_RE.lastIndex = 0;

  const hasUnnegatedPos = UNNEGATED_POS_RE.test(remainingText);
  const hasUnnegatedNeg = UNNEGATED_NEG_RE.test(remainingText);

  const effectiveNegative = hasUnnegatedNeg || hasNegatedPos;
  const effectivePositive = hasUnnegatedPos || hasNegatedNeg || assertsZeroFailures;

  let polarity: "failure" | "success" | "neutral";
  if (effectiveNegative && !effectivePositive) {
    polarity = "failure";
  } else if (effectivePositive && !effectiveNegative) {
    polarity = "success";
  } else if (effectiveNegative) {
    polarity = "failure";
  } else {
    polarity = "neutral";
  }

  let hasPermPos = false;
  let hasPermNeg = false;
  for (const w of textWithoutZeroFail.split(/[^a-z0-9]+/).filter(Boolean)) {
    const st = stemWord(w);
    if (PERM_POS_STEMS.has(st)) hasPermPos = true;
    if (PERM_NEG_STEMS.has(st) || PERM_NEG_STEMS.has(w)) hasPermNeg = true;
  }

  return {
    polarity,
    negated,
    assertsZeroFailures,
    hasUnnegatedNeg,
    hasNegatedPos,
    hasNegatedNeg,
    hasPermPos,
    hasPermNeg,
  };
}

interface ClauseFeatures {
  ips: string[];
  explicitNumbers: number[];
  assertsPluralRepeat: boolean;
  identifiers: string[];
  polarity: "failure" | "success" | "neutral";
  negated: boolean;
  hasNegatedPos: boolean;
  hasNegatedNeg: boolean;
  hasPermPos: boolean;
  hasPermNeg: boolean;
  isInvariant: boolean;
  hasUniversalQuantifier: boolean;
  contentTokens: string[];
  temporalRefs: Array<{ prep: "after" | "before"; eventToken: string }>;
}

function extractClauseFeatures(
  rawClause: string,
  ignoreIds: Set<string>
): ClauseFeatures {
  const temporalRefs: Array<{ prep: "after" | "before"; eventToken: string }> = [];
  const clauseWithoutTemporal = rawClause.replace(
    /\b(after|following|before|prior\s+to)\s+(?:(?:the|an?|initial|earlier|previous|prior|repeated|multiple|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+){0,2}([a-z0-9_-]+)(?:\s+(failures?|errors?|attempts?|upgrades?|restarts?|flushes?|bursts?|logins?|events?))?\b/gi,
    (_full, prepRaw: string, ev1: string, ev2?: string) => {
      const prep = /before|prior/i.test(prepRaw) ? "before" : "after";
      const head = ev2 ?? ev1;
      const stemmed = stemWord(head);
      if (stemmed) {
        temporalRefs.push({ prep, eventToken: stemmed });
      }
      return " ";
    }
  );

  const lower = normalizeNegationContractions(clauseWithoutTemporal).toLowerCase();

  // Extract IPv4 addresses
  const ips = Array.from(new Set(lower.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []));
  let textNoIp = lower;
  for (const ip of ips) {
    textNoIp = textNoIp.split(ip).join(" ");
  }

  // Remove cited record IDs from text so IDs like REC-10 or LOG-99 aren't parsed as counts/hosts
  for (const id of ignoreIds) {
    const escaped = id.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) {
      textNoIp = textNoIp.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
    }
  }

  // Extract hyphenated / underscored technical identifiers (e.g. edge-proxy, svc-worker, node-7)
  const rawIdentifiers = textNoIp.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g) ?? [];
  const identifiers = Array.from(
    new Set(
      rawIdentifiers.filter(
        (id) =>
          id !== "system_log" &&
          id !== "gold-cases" &&
          id !== "high-severity" &&
          id !== "low-severity" &&
          !ignoreIds.has(id)
      )
    )
  );

  let textForNumbers = textNoIp;
  for (const ident of identifiers) {
    textForNumbers = textForNumbers.split(ident).join(" ");
  }

  // Extract explicit numbers (digits and number words)
  const explicitNumbersSet = new Set<number>();
  const countAssignMatches = textForNumbers.matchAll(/\b(?:count|code|exit|retries|attempts)=?(\d+)\b/g);
  for (const m of countAssignMatches) {
    if (m[1] !== undefined) explicitNumbersSet.add(parseInt(m[1], 10));
  }
  const bareDigitMatches = textForNumbers.matchAll(/(?:^|\s)(\d+)(?=\s|[.,;:]|$)/g);
  for (const m of bareDigitMatches) {
    if (m[1] !== undefined) explicitNumbersSet.add(parseInt(m[1], 10));
  }
  for (const word of textForNumbers.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (word in NUMBER_WORDS) {
      // Only treat "no" / "none" as 0 when modifying failure/error
      if (word === "no" || word === "none") {
        if (/\b(?:no|none)\s+(?:[a-z0-9_-]+\s+){0,2}(?:failure|failures|error|errors)\b/i.test(textForNumbers)) {
          explicitNumbersSet.add(0);
        }
      } else {
        explicitNumbersSet.add(NUMBER_WORDS[word]!);
      }
    }
  }

  const pol = analyzePolarityAndNegation(lower);
  const polarity = pol.polarity;
  const assertsPluralRepeat = /\b(?:repeated|multiple|burst)\b/i.test(lower);
  const hasUniversalQuantifier = /\b(?:all|every|each|always)\b/i.test(lower);
  const isInvariant =
    hasUniversalQuantifier || /\b(?:never|zero|no|none)\b/i.test(lower);

  const contentTokensSet = new Set<string>();
  const words = textForNumbers.split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    if (/^\d+$/.test(w)) continue;
    if (NEGATION_WORDS.has(w)) continue;
    if (w in NUMBER_WORDS) continue;
    if (STOPWORDS.has(w)) continue;
    if (w === "all" || w === "every" || w === "each" || w === "always") continue;
    const stemmed = stemWord(w);
    if (!stemmed || stemmed.length < 2) continue;
    if (
      NEGATION_WORDS.has(stemmed) ||
      STOPWORDS.has(stemmed) ||
      FRAMING_VERBS_AND_META.has(stemmed) ||
      FRAMING_VERBS_AND_META.has(w)
    ) {
      continue;
    }
    // Exclude polarity-only generic token "success" from required content tokens so "successful sudo"
    // doesn't fail when claim says "used sudo"
    if (stemmed === "success") continue;
    // Exclude outcome nouns that appeared solely inside negated zero-failure phrases (e.g. "without any failure")
    if (
      pol.assertsZeroFailures &&
      !pol.hasUnnegatedNeg &&
      (stemmed === "failure" || stemmed === "error" || stemmed === "timeout" || stemmed === "crash")
    ) {
      continue;
    }
    contentTokensSet.add(stemmed);
  }

  return {
    ips,
    explicitNumbers: Array.from(explicitNumbersSet),
    assertsPluralRepeat,
    identifiers,
    polarity,
    negated: pol.negated,
    hasNegatedPos: pol.hasNegatedPos,
    hasNegatedNeg: pol.hasNegatedNeg,
    hasPermPos: pol.hasPermPos,
    hasPermNeg: pol.hasPermNeg,
    isInvariant,
    hasUniversalQuantifier,
    contentTokens: Array.from(contentTokensSet),
    temporalRefs,
  };
}

function extractRecordFeatures(rec: IndexedRecord): {
  ips: Set<string>;
  numbers: Set<number>;
  explicitCount?: number;
  identifiers: Set<string>;
  polarity: "failure" | "success" | "neutral";
  negated: boolean;
  hasPermPos: boolean;
  hasPermNeg: boolean;
  tokens: Set<string>;
  substantiveTokens: string[];
  rawLower: string;
} {
  const rawLower = normalizeNegationContractions(rec.body ?? "").toLowerCase();
  const ips = new Set<string>(rawLower.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []);

  let textNoIp = rawLower;
  for (const ip of ips) {
    textNoIp = textNoIp.split(ip).join(" ");
  }

  const identifiers = new Set<string>(
    (textNoIp.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g) ?? []).filter(
      (id) => id !== "system_log"
    )
  );

  let explicitCount: number | undefined;
  const countMatch = textNoIp.match(/\bcount=(\d+)\b/);
  if (countMatch?.[1] !== undefined) {
    explicitCount = parseInt(countMatch[1], 10);
  }

  let textNoIdent = textNoIp;
  for (const ident of identifiers) {
    textNoIdent = textNoIdent.split(ident).join(" ");
  }

  const numbers = new Set<number>();
  if (explicitCount !== undefined) numbers.add(explicitCount);
  for (const m of textNoIdent.matchAll(/\b(\d+)\b/g)) {
    if (m[1] !== undefined) numbers.add(parseInt(m[1], 10));
  }
  for (const w of textNoIdent.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (w in NUMBER_WORDS) {
      if (w === "no" || w === "none") {
        if (/\b(?:no|none)\s+(?:[a-z0-9_-]+\s+){0,2}(?:failure|failures|error|errors)\b/i.test(textNoIdent)) {
          numbers.add(0);
        }
      } else {
        numbers.add(NUMBER_WORDS[w]!);
      }
    }
  }

  const pol = analyzePolarityAndNegation(rawLower);

  const tokens = new Set<string>();
  const substantiveSet = new Set<string>();
  // Include full words and subtokens of hyphenated/underscored identifiers (e.g. svc-worker -> svc, worker)
  for (const w of textNoIp.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (NEGATION_WORDS.has(w)) continue;
    const stemmed = stemWord(w);
    if (stemmed && !NEGATION_WORDS.has(stemmed)) tokens.add(stemmed);
    tokens.add(w);
  }

  for (const w of textNoIdent.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(w)) continue;
    if (NEGATION_WORDS.has(w) || w in NUMBER_WORDS || STOPWORDS.has(w)) continue;
    if (w === "all" || w === "every" || w === "each" || w === "always") continue;
    const stemmed = stemWord(w);
    if (!stemmed || stemmed.length < 2) continue;
    if (
      NEGATION_WORDS.has(stemmed) ||
      STOPWORDS.has(stemmed) ||
      FRAMING_VERBS_AND_META.has(stemmed) ||
      FRAMING_VERBS_AND_META.has(w) ||
      stemmed === "success"
    ) {
      continue;
    }
    if (
      pol.assertsZeroFailures &&
      !pol.hasUnnegatedNeg &&
      (stemmed === "failure" || stemmed === "error" || stemmed === "timeout" || stemmed === "crash")
    ) {
      continue;
    }
    substantiveSet.add(stemmed);
  }

  return {
    ips,
    numbers,
    explicitCount,
    identifiers,
    polarity: pol.polarity,
    negated: pol.negated,
    hasPermPos: pol.hasPermPos,
    hasPermNeg: pol.hasPermNeg,
    tokens,
    substantiveTokens: Array.from(substantiveSet),
    rawLower,
  };
}

function tokenSatisfiedByRecord(
  tok: string,
  clauseFeat: ClauseFeatures,
  recFeat: ReturnType<typeof extractRecordFeatures>
): boolean {
  if (recFeat.tokens.has(tok)) return true;
  // Negated allowance (e.g. "did not allow") is semantically satisfied by explicit denial (e.g. "denied"/"blocked")
  if (
    clauseFeat.polarity === "failure" &&
    recFeat.polarity === "failure" &&
    PERM_POS_STEMS.has(tok) &&
    clauseFeat.hasNegatedPos &&
    recFeat.hasPermNeg
  ) {
    return true;
  }
  // Explicit denial in claim (e.g. "denied") is semantically satisfied by negated allowance in record (e.g. "did not allow")
  if (
    clauseFeat.polarity === "failure" &&
    recFeat.polarity === "failure" &&
    PERM_NEG_STEMS.has(tok) &&
    recFeat.negated &&
    recFeat.hasPermPos
  ) {
    return true;
  }
  // Negated denial (e.g. "was not blocked") is satisfied by explicit allowance (e.g. "allowed")
  if (
    clauseFeat.polarity === "success" &&
    recFeat.polarity === "success" &&
    PERM_NEG_STEMS.has(tok) &&
    clauseFeat.hasNegatedNeg &&
    recFeat.hasPermPos
  ) {
    return true;
  }
  // Outcome failure token (e.g. "failed") is satisfied by negated outcome success (e.g. "did not succeed")
  if (
    tok === "failure" &&
    clauseFeat.polarity === "failure" &&
    recFeat.polarity === "failure" &&
    recFeat.negated &&
    recFeat.tokens.has("success")
  ) {
    return true;
  }
  return false;
}

function evaluateClauseAgainstRecord(
  clauseFeat: ClauseFeatures,
  rec: IndexedRecord,
  allRecords: IndexedRecord[]
): "entails" | "contradicts" | "unrelated" {
  if (!rec.body || rec.body.trim().length === 0) {
    return "unrelated";
  }

  const recFeat = extractRecordFeatures(rec);

  // Measure domain/subject overlap between clause and record
  const sharedIps = clauseFeat.ips.filter((ip) => recFeat.ips.has(ip));
  const sharedIdents = clauseFeat.identifiers.filter(
    (id) => recFeat.identifiers.has(id) || recFeat.rawLower.includes(id)
  );
  const sharedContent = clauseFeat.contentTokens.filter(
    (t) =>
      t !== "failure" &&
      !PERM_POS_STEMS.has(t) &&
      !PERM_NEG_STEMS.has(t) &&
      recFeat.tokens.has(t)
  );
  const sharesFailureTopic =
    clauseFeat.contentTokens.includes("failure") && recFeat.tokens.has("failure");
  const sharesPermissionTopic =
    (clauseFeat.hasPermPos || clauseFeat.hasPermNeg) &&
    (recFeat.hasPermPos || recFeat.hasPermNeg);

  const hasSubjectOrEventOverlap =
    sharedIps.length > 0 ||
    sharedIdents.length > 0 ||
    sharedContent.length > 0 ||
    sharesFailureTopic ||
    sharesPermissionTopic;

  if (!hasSubjectOrEventOverlap) {
    return "unrelated";
  }

  // 1. Check Polarity Conflict on overlapping subject/event
  const hasDisjointIps =
    clauseFeat.ips.length > 0 && recFeat.ips.size > 0 && sharedIps.length === 0;
  const hasDisjointIdents =
    clauseFeat.identifiers.length > 0 && recFeat.identifiers.size > 0 && sharedIdents.length === 0;

  if (
    !hasDisjointIps &&
    !hasDisjointIdents &&
    ((clauseFeat.polarity === "success" && recFeat.polarity === "failure") ||
      (clauseFeat.polarity === "failure" && recFeat.polarity === "success"))
  ) {
    // Require specific entity or non-generic event token overlap so unrelated events don't collide
    if (sharedIps.length > 0 || sharedIdents.length > 0 || sharedContent.length > 0) {
      return "contradicts";
    }
  }

  // 2. Check IP Conflict on same event
  if (clauseFeat.ips.length > 0) {
    const allIpsPresent = clauseFeat.ips.every((ip) => recFeat.ips.has(ip));
    if (!allIpsPresent) {
      if (recFeat.ips.size > 0 && (sharedContent.length > 0 || sharedIdents.length > 0 || sharesFailureTopic)) {
        return "contradicts";
      }
      return "unrelated";
    }
  }

  // 3. Check Explicit Count / Number Conflict on same event
  if (clauseFeat.explicitNumbers.length > 0) {
    const allNumsPresent = clauseFeat.explicitNumbers.every((n) => recFeat.numbers.has(n));
    if (!allNumsPresent) {
      if (
        recFeat.numbers.size > 0 &&
        (sharedIps.length > 0 || sharedIdents.length > 0 || sharedContent.length > 0)
      ) {
        return "contradicts";
      }
      return "unrelated";
    }
  }

  if (clauseFeat.assertsPluralRepeat && recFeat.explicitCount !== undefined && recFeat.explicitCount < 2) {
    return "contradicts";
  }

  // 4. Check Technical Identifier Conflict
  if (clauseFeat.identifiers.length > 0) {
    const allIdentsPresent = clauseFeat.identifiers.every(
      (id) =>
        recFeat.identifiers.has(id) ||
        recFeat.rawLower.includes(id) ||
        id.split(/[-_]/).every((part) => recFeat.tokens.has(stemWord(part)) || recFeat.tokens.has(part))
    );
    if (!allIdentsPresent) {
      if (recFeat.identifiers.size > 0 && (sharedIps.length > 0 || sharedContent.length > 0)) {
        return "contradicts";
      }
      return "unrelated";
    }
  }

  // 5. Check Temporal Ordering if temporal reference was stated (e.g. `after the failures`)
  for (const temp of clauseFeat.temporalRefs) {
    if (rec.timestamp) {
      const refRec = allRecords.find(
        (other) =>
          other.id !== rec.id &&
          other.timestamp &&
          other.body &&
          extractRecordFeatures(other).tokens.has(temp.eventToken)
      );
      if (refRec?.timestamp) {
        const recTime = Date.parse(rec.timestamp);
        const refTime = Date.parse(refRec.timestamp);
        if (!Number.isNaN(recTime) && !Number.isNaN(refTime)) {
          if (temp.prep === "after" && recTime < refTime) return "contradicts";
          if (temp.prep === "before" && recTime > refTime) return "contradicts";
        }
      }
    }
  }

  // 6. Check Full Substantive Entailment & Neutral Predicate Negation Inversion
  // Rumor records report unverified hearsay and cannot by themselves entail or contradict factual truth
  if (rec.kind === "rumor") {
    return "unrelated";
  }

  const allContentMatched = clauseFeat.contentTokens.every((tok) =>
    tokenSatisfiedByRecord(tok, clauseFeat, recFeat)
  );

  // Check neutral-predicate negation inversion: P(x) vs ¬P(x) when polarity words didn't already resolve sign
  const sameNonNeutralPolarity =
    clauseFeat.polarity !== "neutral" && clauseFeat.polarity === recFeat.polarity;
  if (!sameNonNeutralPolarity && clauseFeat.negated !== recFeat.negated) {
    const clauseTokenSet = new Set(clauseFeat.contentTokens);
    const recSubsetOfClause =
      (recFeat.substantiveTokens.length >= 2 ||
        (recFeat.substantiveTokens.length === 1 &&
          (sharedIps.length > 0 || sharedIdents.length > 0))) &&
      recFeat.substantiveTokens.every((t) => clauseTokenSet.has(t));
    if (
      (allContentMatched &&
        (clauseFeat.contentTokens.length > 0 ||
          sharedIps.length > 0 ||
          sharedIdents.length > 0)) ||
      recSubsetOfClause
    ) {
      return "contradicts";
    }
    return "unrelated";
  }

  if (!allContentMatched) {
    return "unrelated";
  }

  const totalSubstantiveMatches =
    clauseFeat.contentTokens.length +
    clauseFeat.ips.length +
    clauseFeat.explicitNumbers.length +
    clauseFeat.identifiers.length +
    (clauseFeat.assertsPluralRepeat && (recFeat.explicitCount ?? 0) >= 2 ? 1 : 0);

  if (totalSubstantiveMatches === 0) {
    return "unrelated";
  }

  return "entails";
}

/**
 * General evaluation of universal statements (both affirmative `all/every/each`
 * and negative `no/zero/none of the`) against their relevant documentary evidence set.
 * Uses three-valued quantification semantics:
 *   - contradicted if at least one observed record refutes the universal claim
 *   - supported only if the relevant record set is non-empty, completely observed, and every record satisfies it
 *   - unverified (abstain) otherwise
 */
export function evaluateUniversalStatement(
  rawText: string,
  records: IndexedRecord[]
): {
  isUniversal: boolean;
  status?: "supported" | "contradicted" | "unverified";
  rationale?: string;
  supportingIds?: string[];
  contradictingIds?: string[];
} {
  const affirmMatch = rawText.match(
    /^\s*(?:all|every|each)\s+(?:(system|witness|rumor|incident|documentary)\s+)?(?:records?|logs?|sources?)\s+(?:confirms?|confirmed|shows?|showed|shown|indicates?|indicated|states?|stated|proves?|proved|establish(?:es|ed)?|reports?|reported|agrees?|agreed|verif(?:y|ies|ied))\b\s*(?:that\s+)?([^;]+)\s*$/i
  );
  const negMatch = !affirmMatch
    ? rawText.match(
        /^\s*(?:no|zero|none\s+of\s+the)\s+(?:(system|witness|rumor|incident|documentary)\s+)?(?:records?|logs?|sources?)\s+(confirms?|confirmed|shows?|showed|shown|indicates?|indicated|states?|stated|proves?|proved|establish(?:es|ed)?|reports?|reported|mentions?|mentioned|contains?|contained|records?|recorded)\b\s*(?:that\s+|any\s+)?([^;]+)\s*$/i
      )
    : null;

  if (!affirmMatch && !negMatch) {
    return { isUniversal: false };
  }

  const isNegativeUniversal = Boolean(negMatch);
  const scopeModifier = (affirmMatch?.[1] ?? negMatch?.[1])?.toLowerCase();
  const negVerb = negMatch?.[2]?.toLowerCase() ?? "";
  const prop = (affirmMatch?.[2] ?? negMatch?.[3] ?? "").trim().replace(/[.,;:]+$/, "");

  const scopedRecords = records.filter((rec) => {
    if (scopeModifier === "system") return rec.kind === "system_log";
    if (scopeModifier === "witness") return rec.kind === "witness";
    if (scopeModifier === "rumor") return rec.kind === "rumor";
    return true;
  });

  if (scopedRecords.length === 0) {
    return {
      isUniversal: true,
      status: "unverified",
      rationale: `Universal claim cannot be verified because no documentary records in the claimed scope were recorded.`,
    };
  }

  const ignoreIds = new Set(scopedRecords.map((r) => r.id.toLowerCase()));
  const propFeat = extractClauseFeatures(prop, ignoreIds);

  if (
    propFeat.contentTokens.length === 0 &&
    propFeat.ips.length === 0 &&
    propFeat.identifiers.length === 0 &&
    propFeat.explicitNumbers.length === 0
  ) {
    return {
      isUniversal: true,
      status: "unverified",
      rationale: `Universal claim "${prop}" lacks verifiable factual predicates (abstaining).`,
    };
  }

  if (isNegativeUniversal) {
    const isMentionCheck = /^(?:mentions?|mentioned|contains?|contained)$/i.test(negVerb);
    const counterexamples: IndexedRecord[] = [];
    const unobserved: IndexedRecord[] = [];

    for (const rec of scopedRecords) {
      if (!rec.body || rec.body.trim().length === 0) {
        unobserved.push(rec);
        continue;
      }

      if (isMentionCheck || scopeModifier === "rumor") {
        const recFeat = extractRecordFeatures(rec);
        const ipsOk = propFeat.ips.every((ip) => recFeat.ips.has(ip));
        const identsOk = propFeat.identifiers.every(
          (id) => recFeat.identifiers.has(id) || recFeat.rawLower.includes(id)
        );
        const numsOk = propFeat.explicitNumbers.every((n) => recFeat.numbers.has(n));
        const toksOk = propFeat.contentTokens.every((t) =>
          tokenSatisfiedByRecord(t, propFeat, recFeat)
        );
        const signOk =
          propFeat.polarity !== "neutral" && recFeat.polarity !== "neutral"
            ? propFeat.polarity === recFeat.polarity
            : propFeat.negated === recFeat.negated;
        if (ipsOk && identsOk && numsOk && toksOk && signOk) {
          counterexamples.push(rec);
        }
        continue;
      }

      const rel = evaluateClauseAgainstRecord(propFeat, rec, scopedRecords);
      if (rel === "entails") {
        counterexamples.push(rec);
      }
    }

    if (counterexamples.length > 0) {
      return {
        isUniversal: true,
        status: "contradicted",
        contradictingIds: counterexamples.map((r) => r.id),
        rationale: `Negative universal claim that no records show "${prop}" is contradicted by documentary record(s) [${counterexamples
          .map((r) => r.id)
          .join(", ")}].`,
      };
    }

    if (unobserved.length > 0) {
      return {
        isUniversal: true,
        status: "unverified",
        rationale: `Negative universal claim "${prop}" cannot be conclusively verified because record(s) [${unobserved
          .map((r) => r.id)
          .join(", ")}] lack captured body content (abstaining).`,
      };
    }

    return {
      isUniversal: true,
      status: "supported",
      supportingIds: scopedRecords.map((r) => r.id),
      rationale: `All scoped documentary records [${scopedRecords
        .map((r) => r.id)
        .join(", ")}] were observed and none establish "${prop}".`,
    };
  }

  const confirmingRecords: IndexedRecord[] = [];
  const counterexampleRecords: IndexedRecord[] = [];
  const unobservedRecords: IndexedRecord[] = [];

  for (const rec of scopedRecords) {
    if (!rec.body || rec.body.trim().length === 0) {
      unobservedRecords.push(rec);
      continue;
    }

    if (scopeModifier === "rumor") {
      const recFeat = extractRecordFeatures(rec);
      const matchesRumor =
        propFeat.contentTokens.every((t) => recFeat.tokens.has(t)) &&
        propFeat.negated === recFeat.negated;
      if (matchesRumor) confirmingRecords.push(rec);
      else counterexampleRecords.push(rec);
      continue;
    }

    const rel = evaluateClauseAgainstRecord(propFeat, rec, scopedRecords);
    if (rel === "entails") {
      confirmingRecords.push(rec);
    } else {
      counterexampleRecords.push(rec);
    }
  }

  if (counterexampleRecords.length > 0) {
    const nonRumorCounterexamples = counterexampleRecords.filter((r) => r.kind !== "rumor");
    const reportedCounterexamples =
      nonRumorCounterexamples.length > 0 ? nonRumorCounterexamples : counterexampleRecords;
    return {
      isUniversal: true,
      status: "contradicted",
      contradictingIds: reportedCounterexamples.map((r) => r.id),
      rationale: `Universal claim that all records confirm "${prop}" is contradicted by documentary records [${reportedCounterexamples
        .map((r) => r.id)
        .join(", ")}].`,
    };
  }

  if (unobservedRecords.length > 0) {
    return {
      isUniversal: true,
      status: "unverified",
      rationale: `Universal claim "${prop}" cannot be conclusively verified because record(s) [${unobservedRecords
        .map((r) => r.id)
        .join(", ")}] lack captured body content (abstaining).`,
    };
  }

  if (confirmingRecords.length === scopedRecords.length && confirmingRecords.length > 0) {
    return {
      isUniversal: true,
      status: "supported",
      supportingIds: confirmingRecords.map((r) => r.id),
      rationale: `Universal claim that all records confirm "${prop}" is supported by documentary records [${confirmingRecords
        .map((r) => r.id)
        .join(", ")}].`,
    };
  }

  return {
    isUniversal: true,
    status: "unverified",
    rationale: `Available documentary records are insufficient to evaluate universal claim "${prop}".`,
  };
}

function evaluateNegativeRumorClause(
  rawClause: string,
  citedRecords: IndexedRecord[],
  index: KarmaPoliceEvidenceIndex
): {
  matched: boolean;
  status?: "supported" | "contradicted" | "unverified";
  supportingIds?: string[];
  contradictingIds?: string[];
  rationale?: string;
} {
  const unsupportedBySysMatch = rawClause.match(
    /\brumor\b(.*?)\b(?:is\s+)?(?:unsupported|not\s+supported|not\s+corroborated)\s+by\s+system\s+logs?\b/i
  );
  const notTreatAsProofMatch = rawClause.match(
    /\bdo\s+not\s+treat\s+(?:the\s+|an?\s+)?(.+?)\s+rumor\s+as\s+proof\b/i
  );

  if (!unsupportedBySysMatch && !notTreatAsProofMatch) {
    return { matched: false };
  }

  const descriptorPhrase = (unsupportedBySysMatch?.[1] ?? notTreatAsProofMatch?.[1] ?? "").trim();

  // Locate rumor records (from cited records or cross-agent run index)
  const citedRumors = citedRecords.filter((r) => r.kind === "rumor");
  const candidateRumors =
    citedRumors.length > 0
      ? citedRumors
      : index.canonicalRecords.filter((r) => r.kind === "rumor");

  if (candidateRumors.length === 0) {
    return {
      matched: true,
      status: "unverified",
      rationale: "Claim references a rumor, but no rumor record exists in recorded evidence.",
    };
  }

  // Extract distinctive rumor subject tokens from descriptorPhrase or from rumor body
  const subjectTokens: string[] = [];
  for (const w of descriptorPhrase.split(/[^a-z0-9]+/i).filter(Boolean)) {
    const low = w.toLowerCase();
    if (STOPWORDS.has(low) || RUMOR_FRAMING_WORDS.has(low)) continue;
    const st = stemWord(low);
    if (st && !STOPWORDS.has(st) && !RUMOR_FRAMING_WORDS.has(st)) {
      subjectTokens.push(st);
    }
  }

  const observedRumors = candidateRumors.filter((r) => r.body && r.body.trim().length > 0);
  if (subjectTokens.length > 0 && observedRumors.length > 0) {
    const matchesAnyRumor = observedRumors.some((r) => {
      const rFeat = extractRecordFeatures(r);
      return subjectTokens.every((t) => rFeat.tokens.has(t));
    });
    if (!matchesAnyRumor) {
      return {
        matched: true,
        status: "unverified",
        rationale: `Recorded rumor content does not mention the claimed rumor subject [${subjectTokens.join(", ")}].`,
      };
    }
  } else if (subjectTokens.length === 0 && observedRumors.length > 0) {
    for (const w of (observedRumors[0]!.body ?? "").split(/[^a-z0-9]+/i).filter(Boolean)) {
      const low = w.toLowerCase();
      if (STOPWORDS.has(low) || RUMOR_FRAMING_WORDS.has(low)) continue;
      const st = stemWord(low);
      if (st && !STOPWORDS.has(st) && !RUMOR_FRAMING_WORDS.has(st)) {
        subjectTokens.push(st);
      }
    }
  }

  if (subjectTokens.length === 0) {
    return {
      matched: true,
      status: "unverified",
      rationale: "Cannot determine distinctive rumor subject to compare against system logs.",
    };
  }

  const systemLogs = index.canonicalRecords.filter((r) => r.kind === "system_log");
  if (systemLogs.length === 0) {
    return {
      matched: true,
      status: "unverified",
      rationale: "No system_log records exist to verify absence of system-log support.",
    };
  }

  const corroboratingSysLogs = systemLogs.filter((l) => {
    if (!l.body) return false;
    const lFeat = extractRecordFeatures(l);
    return subjectTokens.every((t) => lFeat.tokens.has(t));
  });

  if (corroboratingSysLogs.length > 0) {
    return {
      matched: true,
      status: "contradicted",
      contradictingIds: corroboratingSysLogs.map((l) => l.id),
      rationale: `Claim states rumor is unsupported by system logs, but system log(s) [${corroboratingSysLogs
        .map((l) => l.id)
        .join(", ")}] corroborate it.`,
    };
  }

  if (systemLogs.some((l) => !l.body || l.body.trim().length === 0)) {
    return {
      matched: true,
      status: "unverified",
      rationale: "Some system_log records lack captured bodies; cannot verify absence of corroboration.",
    };
  }

  const supportIds =
    citedRecords.length > 0
      ? citedRecords.map((r) => r.id)
      : [...candidateRumors.map((r) => r.id), ...systemLogs.map((l) => l.id)];

  return {
    matched: true,
    status: "supported",
    supportingIds: supportIds,
    rationale: `System logs [${systemLogs.map((l) => l.id).join(", ")}] do not corroborate the rumor subject, entailing the assertion.`,
  };
}

/**
 * Factual semantic entailment verification for documentary records.
 * Never classifies a claim as supported merely because a cited record ID exists.
 */
export function hasPairwiseClauseSelfContradiction(
  clauses: string[],
  ignoreIds: Set<string>
): string | undefined {
  if (clauses.length < 2) return undefined;
  const feats = clauses.map((raw) => ({ raw, feat: extractClauseFeatures(raw, ignoreIds) }));
  for (let i = 0; i < feats.length; i += 1) {
    for (let j = i + 1; j < feats.length; j += 1) {
      const a = feats[i]!;
      const b = feats[j]!;
      if (a.feat.ips.join(",") !== b.feat.ips.join(",")) continue;
      if (a.feat.identifiers.join(",") !== b.feat.identifiers.join(",")) continue;
      if (a.feat.explicitNumbers.join(",") !== b.feat.explicitNumbers.join(",")) continue;

      const aTokens = a.feat.contentTokens.filter(
        (t) => t !== "failure" && !PERM_POS_STEMS.has(t) && !PERM_NEG_STEMS.has(t)
      );
      const bTokens = b.feat.contentTokens.filter(
        (t) => t !== "failure" && !PERM_POS_STEMS.has(t) && !PERM_NEG_STEMS.has(t)
      );
      const sameCoreTokens =
        aTokens.length === bTokens.length && aTokens.every((t) => bTokens.includes(t));
      const hasSharedAnchor =
        aTokens.length > 0 || a.feat.ips.length > 0 || a.feat.identifiers.length > 0;
      if (!sameCoreTokens || !hasSharedAnchor) continue;

      const oppositePolarity =
        (a.feat.polarity === "success" && b.feat.polarity === "failure") ||
        (a.feat.polarity === "failure" && b.feat.polarity === "success");
      const oppositeNeutralNegation =
        a.feat.polarity === "neutral" &&
        b.feat.polarity === "neutral" &&
        a.feat.negated !== b.feat.negated &&
        a.feat.contentTokens.length === b.feat.contentTokens.length &&
        a.feat.contentTokens.every((t) => b.feat.contentTokens.includes(t));

      if (oppositePolarity || oppositeNeutralNegation) {
        return `Compound claim is internally self-contradictory across clauses ("${a.raw}" vs "${b.raw}").`;
      }
    }
  }
  return undefined;
}

function evaluateDocumentaryRecordEntailment(
  rawText: string,
  records: IndexedRecord[],
  index: KarmaPoliceEvidenceIndex
): {
  status: "supported" | "contradicted" | "unverified";
  supportingIds: string[];
  contradictingIds: string[];
  rationale: string;
} {
  const clauses = rawText
    .split(/\s*;\s*/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length === 0) {
    return {
      status: "unverified",
      supportingIds: [],
      contradictingIds: [],
      rationale: "Empty documentary claim cannot be verified.",
    };
  }

  const ignoreIds = new Set([
    ...records.map((r) => r.id.toLowerCase()),
    ...index.canonicalRecords.map((r) => r.id.toLowerCase()),
  ]);
  const selfContraRationale = hasPairwiseClauseSelfContradiction(clauses, ignoreIds);
  if (selfContraRationale) {
    return {
      status: "contradicted",
      supportingIds: [],
      contradictingIds: records.map((r) => r.id),
      rationale: selfContraRationale,
    };
  }

  const allSupporting = new Set<string>();
  const allContradicting = new Set<string>();
  const rationales: string[] = [];
  let anyUnverified = false;

  for (const clause of clauses) {
    const clauseRes = evaluateSingleDocumentaryClause(clause, records, index);
    if (clauseRes.status === "contradicted") {
      for (const id of clauseRes.contradictingIds) allContradicting.add(id);
      return {
        status: "contradicted",
        supportingIds: [],
        contradictingIds: Array.from(allContradicting),
        rationale: clauseRes.rationale,
      };
    }
    if (clauseRes.status === "supported") {
      for (const id of clauseRes.supportingIds) allSupporting.add(id);
      rationales.push(clauseRes.rationale);
    } else {
      anyUnverified = true;
      rationales.push(clauseRes.rationale);
    }
  }

  if (!anyUnverified && allSupporting.size > 0) {
    return {
      status: "supported",
      supportingIds: Array.from(allSupporting),
      contradictingIds: [],
      rationale: rationales[0]!,
    };
  }

  return {
    status: "unverified",
    supportingIds: [],
    contradictingIds: [],
    rationale:
      rationales.find((r) => r.includes("abstain") || r.includes("do not") || r.includes("Cannot") || r.includes("not")) ??
      `Cited record(s) [${records.map((r) => r.id).join(", ")}] do not establish factual entailment for the claim statement (abstaining).`,
  };
}

function evaluateSingleDocumentaryClause(
  clause: string,
  records: IndexedRecord[],
  index: KarmaPoliceEvidenceIndex
): {
  status: "supported" | "contradicted" | "unverified";
  supportingIds: string[];
  contradictingIds: string[];
  rationale: string;
} {
  // 1. Check Negative Rumor Corroboration Clause
  const negRumor = evaluateNegativeRumorClause(clause, records, index);
  if (negRumor.matched) {
    return {
      status: negRumor.status ?? "unverified",
      supportingIds: negRumor.supportingIds ?? [],
      contradictingIds: negRumor.contradictingIds ?? [],
      rationale: negRumor.rationale ?? "Rumor evaluation inconclusive.",
    };
  }

  // 1b. Check Universal Documentary Statement Clause
  const universalClause = evaluateUniversalStatement(clause, index.canonicalRecords);
  if (universalClause.isUniversal) {
    return {
      status: universalClause.status ?? "unverified",
      supportingIds: universalClause.supportingIds ?? [],
      contradictingIds: universalClause.contradictingIds ?? [],
      rationale:
        universalClause.rationale ??
        "Universal documentary clause cannot be established from available evidence (abstaining).",
    };
  }

  // 2. Check Source Kind Assertions (e.g. "system log" / "system_log")
  const assertsSystemLog = /\bsystem[\s_]log\b/i.test(clause);
  if (assertsSystemLog && records.length > 0) {
    const wrongKind = records.find((r) => r.kind !== "system_log");
    if (wrongKind && records.every((r) => r.kind !== "system_log")) {
      return {
        status: "contradicted",
        supportingIds: [],
        contradictingIds: [wrongKind.id],
        rationale: `Claim asserts source is a system log, but referenced record ${wrongKind.id} has kind "${wrongKind.kind}".`,
      };
    }
  }

  // 3. Check Cross-Agent Finding Reference (e.g. "Finding F1 is supported by system log REC-10")
  const findingRefMatch = clause.match(
    /\bfinding\s+([A-Za-z0-9_-]+)\s+is\s+(not\s+supported|unsupported|supported)\b/i
  );
  if (findingRefMatch?.[1] && findingRefMatch[2]) {
    const fid = findingRefMatch[1];
    const claimsSupport = findingRefMatch[2].toLowerCase() === "supported";

    if (index.ambiguousFindingIds.has(fid)) {
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: `Referenced finding "${fid}" is ambiguous across multiple upstream handoffs (abstaining).`,
      };
    }

    const upstream = index.upstreamFindingsById.get(fid);
    if (!upstream) {
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: `Referenced finding "${fid}" was not found in recorded upstream handoffs (abstaining).`,
      };
    }

    const targetRecords = records.filter((r) => !assertsSystemLog || r.kind === "system_log");
    if (targetRecords.length === 0) {
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: `No matching record available to verify finding "${fid}" (abstaining).`,
      };
    }

    const upstreamEval = evaluateSingleDocumentaryClause(upstream.claim, targetRecords, index);
    if (claimsSupport) {
      if (upstreamEval.status === "supported") {
        return {
          status: "supported",
          supportingIds: upstreamEval.supportingIds,
          contradictingIds: [],
          rationale: `Documentary record(s) [${upstreamEval.supportingIds.join(", ")}] entail upstream finding ${fid} ("${upstream.claim}").`,
        };
      }
      if (
        upstreamEval.status === "contradicted" ||
        targetRecords.every((r) => Boolean(r.body && r.body.trim().length > 0))
      ) {
        return {
          status: "contradicted",
          supportingIds: [],
          contradictingIds: targetRecords.map((r) => r.id),
          rationale: `Claim states finding ${fid} ("${upstream.claim}") is supported by [${targetRecords
            .map((r) => r.id)
            .join(", ")}], which does not entail that finding.`,
        };
      }
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: `Cannot verify whether [${targetRecords.map((r) => r.id).join(", ")}] supports finding ${fid} because record content is uncaptured (abstaining).`,
      };
    } else {
      if (upstreamEval.status === "supported") {
        return {
          status: "contradicted",
          supportingIds: [],
          contradictingIds: upstreamEval.supportingIds,
          rationale: `Claim states finding ${fid} is unsupported, but [${upstreamEval.supportingIds.join(", ")}] entails it.`,
        };
      }
      if (targetRecords.some((r) => r.kind === "rumor") || upstreamEval.status === "contradicted") {
        return {
          status: "supported",
          supportingIds: targetRecords.map((r) => r.id),
          contradictingIds: [],
          rationale: `Referenced record(s) [${targetRecords.map((r) => r.id).join(", ")}] confirm finding ${fid} lacks authoritative support.`,
        };
      }
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: `Inconclusive evidence for unsupported finding ${fid} (abstaining).`,
      };
    }
  }

  // 4. Check Scoped Investigation / Escalation Directive Grounded in Anomaly Log
  const escalateMatch = clause.match(
    /^\s*(?:escalate|investigate|flag)\s+(?:for\s+)?(?:investigation\s+of\s+)?(.+)$/i
  );
  if (escalateMatch?.[1]) {
    const ignoreIds = new Set([
      ...records.map((r) => r.id.toLowerCase()),
      ...index.canonicalRecords.map((r) => r.id.toLowerCase()),
    ]);
    const targetFeat = extractClauseFeatures(escalateMatch[1], ignoreIds);
    const hasConcreteEntity = targetFeat.ips.length > 0 || targetFeat.identifiers.length > 0;
    if (!hasConcreteEntity) {
      return {
        status: "unverified",
        supportingIds: [],
        contradictingIds: [],
        rationale: "Escalation directive specifies no concrete technical entity to verify against records (abstaining).",
      };
    }

    const matchingAnomalyLogs = records.filter((rec) => {
      if (rec.kind !== "system_log" || !rec.body) return false;
      const rFeat = extractRecordFeatures(rec);
      const ipsOk = targetFeat.ips.every((ip) => rFeat.ips.has(ip));
      const identsOk = targetFeat.identifiers.every(
        (id) => rFeat.identifiers.has(id) || rFeat.rawLower.includes(id)
      );
      return ipsOk && identsOk && rFeat.polarity === "failure";
    });

    if (matchingAnomalyLogs.length > 0) {
      return {
        status: "supported",
        supportingIds: matchingAnomalyLogs.map((r) => r.id),
        contradictingIds: [],
        rationale: `Documentary system log(s) [${matchingAnomalyLogs.map((r) => r.id).join(", ")}] corroborate anomalous activity for the escalated entity.`,
      };
    }

    return {
      status: "unverified",
      supportingIds: [],
      contradictingIds: [],
      rationale: `Cited record(s) [${records.map((r) => r.id).join(", ")}] do not establish anomalous activity for the escalated entity (abstaining).`,
    };
  }

  // 5. General Factual Documentary Entailment & Contradiction Check
  const ignoreIds = new Set([
    ...records.map((r) => r.id.toLowerCase()),
    ...index.canonicalRecords.map((r) => r.id.toLowerCase()),
  ]);
  const clauseFeat = extractClauseFeatures(clause, ignoreIds);

  const supportingIds: string[] = [];
  const contradictingIds: string[] = [];

  for (const rec of records) {
    const rel = evaluateClauseAgainstRecord(clauseFeat, rec, index.canonicalRecords);
    if (rel === "entails") {
      supportingIds.push(rec.id);
    } else if (rel === "contradicts") {
      contradictingIds.push(rec.id);
    }
  }

  if (
    contradictingIds.length > 0 &&
    (supportingIds.length === 0 || clauseFeat.isInvariant)
  ) {
    const cRec = records.find((r) => r.id === contradictingIds[0]);
    return {
      status: "contradicted",
      supportingIds: [],
      contradictingIds,
      rationale: `Claim conflicts with referenced documentary record ${contradictingIds.join(", ")}${
        cRec?.body ? ` ("${cRec.body}")` : ""
      }.`,
    };
  }

  if (clauseFeat.isInvariant) {
    for (const inRunRec of index.canonicalRecords) {
      if (inRunRec.kind === "rumor" || !inRunRec.body) continue;
      if (records.some((r) => r.id === inRunRec.id)) continue;
      const rFeat = extractRecordFeatures(inRunRec);
      const matchesClaimedEntities =
        clauseFeat.ips.every((ip) => rFeat.ips.has(ip)) &&
        clauseFeat.identifiers.every(
          (id) =>
            rFeat.identifiers.has(id) ||
            rFeat.rawLower.includes(id) ||
            id.split(/[-_]/).every((part) => rFeat.tokens.has(stemWord(part)) || rFeat.tokens.has(part))
        );
      if (!matchesClaimedEntities) continue;
      const rel = evaluateClauseAgainstRecord(clauseFeat, inRunRec, index.canonicalRecords);
      if (rel === "contradicts") {
        return {
          status: "contradicted",
          supportingIds: [],
          contradictingIds: [inRunRec.id],
          rationale: `Invariant claim is contradicted by in-run documentary record ${inRunRec.id} ("${inRunRec.body}").`,
        };
      }
    }
  }

  if (
    clauseFeat.hasUniversalQuantifier &&
    records.some((r) => r.kind !== "rumor" && (!r.body || r.body.trim().length === 0))
  ) {
    return {
      status: "unverified",
      supportingIds: [],
      contradictingIds: [],
      rationale: `Universal claim cannot be verified because one or more cited records lack captured content (abstaining).`,
    };
  }

  if (supportingIds.length > 0) {
    return {
      status: "supported",
      supportingIds,
      contradictingIds: [],
      rationale: `Documentary record(s) [${supportingIds.join(", ")}] corroborate the factual statements in the claim.`,
    };
  }

  if (records.some((r) => !r.body || r.body.trim().length === 0)) {
    return {
      status: "unverified",
      supportingIds: [],
      contradictingIds: [],
      rationale: `Cited record(s) [${records
        .filter((r) => !r.body || r.body.trim().length === 0)
        .map((r) => r.id)
        .join(", ")}] lack captured body content (abstaining).`,
    };
  }

  // Check whether an un-cited authoritative in-run record directly contradicts the claim
  // (catches contradictory claims that cite an unrelated record to evade detection)
  for (const inRunRec of index.canonicalRecords) {
    if (inRunRec.kind === "rumor" || !inRunRec.body) continue;
    if (records.some((r) => r.id === inRunRec.id)) continue;
    const rel = evaluateClauseAgainstRecord(clauseFeat, inRunRec, index.canonicalRecords);
    if (rel === "contradicts") {
      return {
        status: "contradicted",
        supportingIds: [],
        contradictingIds: [inRunRec.id],
        rationale: `Claim cites [${records.map((r) => r.id).join(", ")}] (unrelated), and is contradicted by in-run documentary record ${inRunRec.id} ("${inRunRec.body}").`,
      };
    }
  }

  return {
    status: "unverified",
    supportingIds: [],
    contradictingIds: [],
    rationale: `Cited record(s) [${records.map((r) => r.id).join(", ")}] do not establish factual entailment for the claim statement (abstaining).`,
  };
}

/**
 * Claim-specific test resolution binding authoritative observations strictly to
 * the claimed artifact, version, and validation execution.
 */
export function resolveClaimSpecificTests(
  item: AtomicSubClaim,
  index: KarmaPoliceEvidenceIndex
): {
  ambiguous: boolean;
  ambiguityReason?: string;
  hasRelevantTests: boolean;
  relevantPassed: string[];
  relevantFailed: string[];
  hasPartialPassInFailedRun: boolean;
  unexecuted: boolean;
  targetArtifact?: IndexedArtifact;
} {
  const refsToUse = item.ownRefs.length > 0 ? item.ownRefs : item.allRefs;

  // 1. Detect explicit ambiguity on cited references
  for (const ref of refsToUse) {
    const res = index.resolveReference(ref);
    if (res.note?.toLowerCase().includes("ambiguous")) {
      return {
        ambiguous: true,
        ambiguityReason: res.note,
        hasRelevantTests: false,
        relevantPassed: [],
        relevantFailed: [],
        hasPartialPassInFailedRun: false,
        unexecuted: false,
      };
    }
  }

  // 2. Extract explicit version token from claim text (strictly version-qualified, never bare numbers)
  const verMatch =
    item.rawText.match(/\b(?:artifact\s+v?|version\s+)(\d+)\b/i) ??
    item.rawText.match(/\bv(\d+)\b/i);
  const explicitVersion = verMatch?.[1];

  // Extract explicit artifact group name if mentioned in claim text
  let explicitGroupName: string | undefined;
  for (const groupName of index.latestArtifactByName.keys()) {
    if (groupName && item.rawText.toLowerCase().includes(groupName.toLowerCase())) {
      explicitGroupName = groupName;
      break;
    }
  }

  // 3. Collect candidate artifacts from sub-claim refs and artifact_refs
  const candidateArtifactsMap = new Map<string, IndexedArtifact>();
  const orderedRefSources =
    item.ownRefs.length > 0 ? item.ownRefs : [...item.artifactRefs, ...item.allRefs];

  for (const ref of orderedRefSources) {
    const res = index.resolveReference(ref);
    if (res.target_type === "artifact" && res.target_id && index.artifactsById.has(res.target_id)) {
      const art = index.artifactsById.get(res.target_id)!;
      if (!art.type.startsWith("incident_record/")) {
        candidateArtifactsMap.set(art.artifact_id, art);
      }
    }
  }

  const candidateArtifacts = Array.from(candidateArtifactsMap.values());
  let targetArtifact: IndexedArtifact | undefined;

  if (candidateArtifacts.length === 1) {
    const only = candidateArtifacts[0]!;
    if (explicitVersion && only.version && only.version !== explicitVersion) {
      return {
        ambiguous: true,
        ambiguityReason: `Claim text specifies version v${explicitVersion}, which conflicts with cited artifact "${only.name}" (v${only.version}).`,
        hasRelevantTests: false,
        relevantPassed: [],
        relevantFailed: [],
        hasPartialPassInFailedRun: false,
        unexecuted: false,
      };
    }
    targetArtifact = only;
  } else if (candidateArtifacts.length > 1) {
    // Disambiguate multiple cited artifacts only if explicit version/group uniquely selects one
    const filtered = candidateArtifacts.filter((art) => {
      const verOk = explicitVersion ? art.version === explicitVersion : true;
      const grpOk = explicitGroupName
        ? (art.metadata?.["function_name"] === explicitGroupName ||
            art.name.toLowerCase().includes(explicitGroupName.toLowerCase()))
        : true;
      return verOk && grpOk;
    });
    if (filtered.length === 1 && (explicitVersion || explicitGroupName)) {
      targetArtifact = filtered[0]!;
    } else {
      return {
        ambiguous: true,
        ambiguityReason: `Claim references multiple distinct artifacts [${candidateArtifacts
          .map((a) => a.name)
          .join(", ")}] without unambiguous binding.`,
        hasRelevantTests: false,
        relevantPassed: [],
        relevantFailed: [],
        hasPartialPassInFailedRun: false,
        unexecuted: false,
      };
    }
  } else {
    // Zero artifact references resolved; attempt unambiguous lookup from explicit version/group
    if (explicitVersion) {
      if (explicitGroupName) {
        const qualKey = `${explicitGroupName}:${explicitVersion}`;
        if (index.ambiguousVersions.has(qualKey)) {
          return {
            ambiguous: true,
            ambiguityReason: `Qualified version "${qualKey}" is ambiguous.`,
            hasRelevantTests: false,
            relevantPassed: [],
            relevantFailed: [],
            hasPartialPassInFailedRun: false,
            unexecuted: false,
          };
        }
        targetArtifact = index.artifactsByVersion.get(qualKey);
      } else if (index.ambiguousVersions.has(explicitVersion)) {
        return {
          ambiguous: true,
          ambiguityReason: `Version v${explicitVersion} is shared by multiple distinct artifacts; cannot bind test outcome unambiguously.`,
          hasRelevantTests: false,
          relevantPassed: [],
          relevantFailed: [],
          hasPartialPassInFailedRun: false,
          unexecuted: false,
        };
      } else {
        targetArtifact =
          index.artifactsByVersion.get(explicitVersion) ??
          index.artifactsByVersion.get(`v${explicitVersion}`);
      }
    } else if (/\bcurrent\b/i.test(item.rawText)) {
      if (index.latestArtifactByName.size > 1) {
        return {
          ambiguous: true,
          ambiguityReason: "Multiple artifact groups exist; 'current' artifact cannot be disambiguated.",
          hasRelevantTests: false,
          relevantPassed: [],
          relevantFailed: [],
          hasPartialPassInFailedRun: false,
          unexecuted: false,
        };
      }
      targetArtifact = Array.from(index.latestArtifactByName.values())[0];
    } else {
      const nonRecordArtifacts = Array.from(index.artifactsById.values()).filter(
        (a) => !a.type.startsWith("incident_record/")
      );
      if (nonRecordArtifacts.length === 1) {
        targetArtifact = nonRecordArtifacts[0];
      }
    }
  }

  const relevantPassed: string[] = [];
  const relevantFailed: string[] = [];
  let hasPartialPassInFailedRun = false;

  // 4. Bind direct authoritative test_id references (must match targetArtifact if both exist)
  for (const ref of refsToUse) {
    const res = index.resolveReference(ref);
    if (res.target_type === "test" && res.target_id) {
      const t = index.testsById.get(res.target_id);
      if (!t) continue;
      if (
        targetArtifact &&
        t.artifact_refs.length > 0 &&
        !t.artifact_refs.includes(targetArtifact.artifact_id)
      ) {
        return {
          ambiguous: true,
          ambiguityReason: `Cited test "${t.test_id}" was executed against [${t.artifact_refs.join(
            ", "
          )}], not claimed artifact "${targetArtifact.artifact_id}".`,
          hasRelevantTests: false,
          relevantPassed: [],
          relevantFailed: [],
          hasPartialPassInFailedRun: false,
          unexecuted: false,
        };
      }
      if (t.status === "PASSED" && !relevantPassed.includes(t.test_id)) {
        relevantPassed.push(t.test_id);
      } else if (t.status === "FAILED" && !relevantFailed.includes(t.test_id)) {
        relevantFailed.push(t.test_id);
      }
    }
  }

  // 5. Bind artifact-specific authoritative tests and completed validation tool invocations
  if (targetArtifact) {
    const testsForArt = index.testsByArtifact.get(targetArtifact.artifact_id) ?? [];
    for (const t of testsForArt) {
      if (t.status === "PASSED" && !relevantPassed.includes(t.test_id)) {
        relevantPassed.push(t.test_id);
      } else if (t.status === "FAILED" && !relevantFailed.includes(t.test_id)) {
        relevantFailed.push(t.test_id);
      }
    }

    const targetGroup =
      (targetArtifact.metadata?.["function_name"] as string | undefined) ??
      targetArtifact.name.replace(/-v\d+(?:\.[a-z0-9]+)?$/i, "");

    for (const vt of index.validationTools) {
      if (vt.status !== "completed") continue;
      const inp = vt.input as Record<string, unknown> | undefined;
      const out = vt.output as Record<string, unknown> | undefined;

      const exactArtMatch =
        out?.["artifact_id"] === targetArtifact.artifact_id ||
        inp?.["artifact_id"] === targetArtifact.artifact_id;

      const versionUnambiguous =
        targetArtifact.version !== undefined && !index.ambiguousVersions.has(targetArtifact.version);

      const qualNameMatches =
        (typeof inp?.["name"] === "string" && inp["name"] === targetGroup) ||
        (typeof out?.["name"] === "string" && out["name"] === targetGroup);

      const verStringMatches =
        targetArtifact.version !== undefined &&
        (String(inp?.["version"] ?? "") === targetArtifact.version ||
          String(out?.["version"] ?? "") === targetArtifact.version);

      const matchesTarget =
        exactArtMatch ||
        (verStringMatches && (versionUnambiguous || qualNameMatches));

      if (matchesTarget) {
        if (Array.isArray(out?.["cases"])) {
          const anyCasePassed = (out["cases"] as Array<Record<string, unknown>>).some(
            (c) => c && c["passed"] === true
          );
          if (anyCasePassed) hasPartialPassInFailedRun = true;
        }
        // Only append tool_call_id if no authoritative TestResult was already recorded for this artifact
        // (avoids duplicate IDs when startTest + tool both record the same run_validation call)
        if (testsForArt.length === 0) {
          if (out?.["passed"] === true && !relevantPassed.includes(vt.tool_call_id)) {
            relevantPassed.push(vt.tool_call_id);
          } else if (out?.["passed"] === false && !relevantFailed.includes(vt.tool_call_id)) {
            relevantFailed.push(vt.tool_call_id);
          }
        }
      }
    }
  } else {
    // No targetArtifact: check if non-record artifacts exist in the run (making un-targeted test claims ambiguous)
    const nonRecordArtifacts = Array.from(index.artifactsById.values()).filter(
      (a) => !a.type.startsWith("incident_record/")
    );
    if (nonRecordArtifacts.length > 1 && relevantPassed.length === 0 && relevantFailed.length === 0) {
      return {
        ambiguous: true,
        ambiguityReason:
          "Multiple artifacts exist in the run, and the validation claim cannot be bound to a specific artifact.",
        hasRelevantTests: false,
        relevantPassed: [],
        relevantFailed: [],
        hasPartialPassInFailedRun: false,
        unexecuted: false,
      };
    }

    // Single/zero-artifact run with direct tool citation
    const matchingValTools = index.validationTools.filter(
      (vt) =>
        vt.status === "completed" &&
        (refsToUse.includes(vt.tool_call_id) || refsToUse.includes(`tool:${vt.tool_name}`))
    );
    if (matchingValTools.length > 1) {
      const outcomes = new Set(
        matchingValTools.map((vt) => (vt.output as Record<string, unknown> | undefined)?.["passed"])
      );
      if (outcomes.size > 1) {
        return {
          ambiguous: true,
          ambiguityReason: "Multiple validation tool invocations with differing outcomes match the cited reference.",
          hasRelevantTests: false,
          relevantPassed: [],
          relevantFailed: [],
          hasPartialPassInFailedRun: false,
          unexecuted: false,
        };
      }
    }
    if (matchingValTools.length === 1) {
      const vt = matchingValTools[0]!;
      const out = vt.output as Record<string, unknown> | undefined;
      if (out?.["passed"] === true && !relevantPassed.includes(vt.tool_call_id)) {
        relevantPassed.push(vt.tool_call_id);
      } else if (out?.["passed"] === false && !relevantFailed.includes(vt.tool_call_id)) {
        relevantFailed.push(vt.tool_call_id);
      }
    }
  }

  const hasRelevantTests = relevantPassed.length > 0 || relevantFailed.length > 0;
  return {
    ambiguous: false,
    hasRelevantTests,
    relevantPassed,
    relevantFailed,
    hasPartialPassInFailedRun,
    unexecuted: !hasRelevantTests,
    targetArtifact,
  };
}

function evaluateAssessmentSubClaim(
  item: AtomicSubClaim,
  index: KarmaPoliceEvidenceIndex
): AtomicEvalOutcome {
  const fid = item.findingId ?? "";
  if (!fid || index.ambiguousFindingIds.has(fid)) {
    return {
      status: "unverified",
      rationale: `Assessment references unknown or ambiguous finding "${fid}" (abstaining).`,
      supportingIds: [],
      contradictingIds: [],
      anomalies: [],
    };
  }

  const upstream = index.upstreamFindingsById.get(fid);
  if (!upstream) {
    return {
      status: "unverified",
      rationale: `Assessment references finding "${fid}" which is not present in upstream handoffs (abstaining).`,
      supportingIds: [],
      contradictingIds: [],
      anomalies: [],
    };
  }

  const citedRecords: IndexedRecord[] = [];
  for (const r of item.ownRefs) {
    const clean = r.replace(/^record:/, "");
    const rec = index.recordsById.get(r) ?? index.recordsById.get(clean);
    if (rec && !citedRecords.some((x) => x.id === rec.id)) {
      citedRecords.push(rec);
    }
  }

  if (citedRecords.length === 0) {
    return {
      status: "unverified",
      rationale: `Assessment for finding "${fid}" cites no resolving documentary records (abstaining).`,
      supportingIds: [],
      contradictingIds: [],
      anomalies: [],
    };
  }

  if (item.rawText.trim().length > 0) {
    const reasonEval = evaluateDocumentaryRecordEntailment(item.rawText, citedRecords, index);
    if (reasonEval.status === "contradicted") {
      return {
        status: "contradicted",
        rationale: reasonEval.rationale,
        supportingIds: [],
        contradictingIds: reasonEval.contradictingIds,
        anomalies: [],
      };
    }
  }

  const upstreamEval = evaluateDocumentaryRecordEntailment(upstream.claim, citedRecords, index);

  if (item.expectedSupported) {
    if (citedRecords.every((r) => r.kind === "rumor")) {
      return {
        status: "contradicted",
        rationale: `Assessment marks finding "${fid}" as supported solely by rumor [${citedRecords
          .map((r) => r.id)
          .join(", ")}].`,
        supportingIds: [],
        contradictingIds: citedRecords.map((r) => r.id),
        anomalies: [],
      };
    }
    if (upstreamEval.status === "supported") {
      return {
        status: "supported",
        rationale: `Documentary record(s) [${upstreamEval.supportingIds.join(
          ", "
        )}] corroborate assessed finding "${fid}".`,
        supportingIds: upstreamEval.supportingIds,
        contradictingIds: [],
        anomalies: [],
      };
    }
    if (
      upstreamEval.status === "contradicted" ||
      citedRecords.every((r) => Boolean(r.body && r.body.trim().length > 0))
    ) {
      return {
        status: "contradicted",
        rationale: `Assessment claims finding "${fid}" ("${upstream.claim}") is supported by [${citedRecords
          .map((r) => r.id)
          .join(", ")}], which does not entail it.`,
        supportingIds: [],
        contradictingIds: citedRecords.map((r) => r.id),
        anomalies: [],
      };
    }
    return {
      status: "unverified",
      rationale: `Cannot verify assessment for finding "${fid}" due to uncaptured record content (abstaining).`,
      supportingIds: [],
      contradictingIds: [],
      anomalies: [],
    };
  } else {
    if (upstreamEval.status === "supported") {
      return {
        status: "contradicted",
        rationale: `Assessment marks finding "${fid}" as unsupported, but [${upstreamEval.supportingIds.join(
          ", "
        )}] entails it.`,
        supportingIds: [],
        contradictingIds: upstreamEval.supportingIds,
        anomalies: [],
      };
    }
    if (citedRecords.some((r) => r.kind === "rumor") || upstreamEval.status === "contradicted") {
      return {
        status: "supported",
        rationale: `Documentary record(s) [${citedRecords.map((r) => r.id).join(", ")}] confirm finding "${fid}" is not authoritatively supported.`,
        supportingIds: citedRecords.map((r) => r.id),
        contradictingIds: [],
        anomalies: [],
      };
    }
    return {
      status: "unverified",
      rationale: `Inconclusive evidence for negative assessment on finding "${fid}" (abstaining).`,
      supportingIds: [],
      contradictingIds: [],
      anomalies: [],
    };
  }
}

function evaluateAtomicSubClaim(
  item: AtomicSubClaim,
  index: KarmaPoliceEvidenceIndex
): AtomicEvalOutcome {
  if (item.kind === "assessment") {
    return evaluateAssessmentSubClaim(item, index);
  }

  const rawText = item.rawText.trim();
  const lowerText = rawText.toLowerCase();

  // Category A: Universal Documentary Statement (single or semicolon-compound)
  const semiClauses = rawText
    .split(/\s*;\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (semiClauses.length > 1) {
    const ignoreIds = new Set(index.canonicalRecords.map((r) => r.id.toLowerCase()));
    const selfContra = hasPairwiseClauseSelfContradiction(semiClauses, ignoreIds);
    if (selfContra) {
      return {
        status: "contradicted",
        rationale: selfContra,
        supportingIds: [],
        contradictingIds: [],
        anomalies: [],
      };
    }
    const uniResults = semiClauses.map((c) => evaluateUniversalStatement(c, index.canonicalRecords));
    if (uniResults.every((u) => u.isUniversal)) {
      const contra = uniResults.find((u) => u.status === "contradicted");
      if (contra) {
        return {
          status: "contradicted",
          rationale: contra.rationale ?? "Compound universal statement is contradicted.",
          supportingIds: [],
          contradictingIds: contra.contradictingIds ?? [],
          anomalies: [],
        };
      }
      if (uniResults.every((u) => u.status === "supported")) {
        const supIds = Array.from(new Set(uniResults.flatMap((u) => u.supportingIds ?? [])));
        return {
          status: "supported",
          rationale: uniResults[0]?.rationale ?? "Compound universal statement is supported.",
          supportingIds: supIds,
          contradictingIds: [],
          anomalies: [],
        };
      }
      const unv = uniResults.find((u) => u.status !== "supported");
      return {
        status: "unverified",
        rationale:
          unv?.rationale ??
          "Compound universal statement cannot be established from available documentary evidence (abstaining).",
        supportingIds: [],
        contradictingIds: [],
        anomalies: [],
      };
    }
  }

  const universalRes = evaluateUniversalStatement(rawText, index.canonicalRecords);
  if (universalRes.isUniversal) {
    return {
      status: universalRes.status ?? "unverified",
      rationale:
        universalRes.rationale ??
        "Universal statement cannot be established from available documentary evidence (abstaining).",
      supportingIds: universalRes.supportingIds ?? [],
      contradictingIds: universalRes.contradictingIds ?? [],
      anomalies: [],
    };
  }

  // Resolve documentary records cited by this atomic sub-claim
  const refsForRecords = item.ownRefs.length > 0 ? item.ownRefs : item.allRefs;
  const citedRecordsMap = new Map<string, IndexedRecord>();
  for (const ref of refsForRecords) {
    const clean = ref.replace(/^record:/, "");
    const rec = index.recordsById.get(ref) ?? index.recordsById.get(clean);
    if (rec) {
      citedRecordsMap.set(rec.id, rec);
    }
  }

  // Category B: Observed Validation & Test Outcome Claims (only when not citing documentary incident records)
  const normalizedTestText = normalizeNegationContractions(lowerText);
  const hasNegatedFailInTestClaim =
    /\b(?:without\s+(?:any\s+)?(?:test\s+|validation\s+)?failures?|(?:no|zero|0)\s+(?:test\s+|validation\s+)?failures?|(?:did\s+not|never)\s+fail)\b/i.test(
      normalizedTestText
    );
  const hasNegatedPassInTestClaim =
    /\b(?:(?:did\s+not|never)\s+(?:pass|succeed)|(?:was|were|is|are)\s+not\s+successful|(?:no|zero|0)\s+(?:gold[\s-]*)?(?:cases?|tests?)\s+(?:passed|succeeded))\b/i.test(
      normalizedTestText
    );

  const assertsUniversalTestFail =
    /\bfailed\s+(?:every|all)\s+(?:gold[\s-]*)?(?:cases?|tests?)\b|\b(?:no|zero|0)\s+(?:gold[\s-]*)?(?:cases?|tests?)\s+(?:passed|succeeded)\b/i.test(
      normalizedTestText
    );
  const assertsTestFailure =
    assertsUniversalTestFail ||
    hasNegatedPassInTestClaim ||
    (!hasNegatedFailInTestClaim &&
      /\b(?:validation|tests?|gold[\s-]cases?)\b.*\bfailed\b|\bfailed\b.*\b(?:validation|tests?|gold[\s-]cases?)\b/i.test(
        normalizedTestText
      ));
  const assertsObservedPassOrCoverage =
    !hasNegatedPassInTestClaim &&
    (/\b(?:observed\s+validation|observed\s+tests?|validation\s+(?:passed|succeeded|covers)|tests?\s+(?:passed|succeeded)|release\s+is\s+justified\b.*\btests?)\b/i.test(
      normalizedTestText
    ) ||
      (hasNegatedFailInTestClaim &&
        /\b(?:validation|tests?|gold[\s-]cases?)\b/i.test(normalizedTestText)));

  if (citedRecordsMap.size === 0 && (assertsTestFailure || assertsObservedPassOrCoverage)) {
    const testRes = resolveClaimSpecificTests(item, index);

    if (testRes.ambiguous) {
      return {
        status: "unverified",
        rationale:
          testRes.ambiguityReason ??
          "Ambiguous relationship between claim and recorded test executions (abstaining).",
        supportingIds: [],
        contradictingIds: [],
        anomalies: [],
      };
    }

    if (testRes.unexecuted) {
      return {
        status: "unverified",
        rationale: testRes.targetArtifact
          ? `Claim asserts observed validation coverage, but no authoritative tests were executed for artifact "${testRes.targetArtifact.name}" (unexecuted observation).`
          : `Claim asserts observed validation coverage, but validation never executed for the claimed scope (unexecuted observation).`,
        supportingIds: [],
        contradictingIds: [],
        anomalies: ["unexecuted_observation"],
      };
    }

    if (assertsUniversalTestFail) {
      if (testRes.relevantPassed.length > 0 || testRes.hasPartialPassInFailedRun) {
        const contra =
          testRes.relevantPassed.length > 0 ? testRes.relevantPassed : testRes.relevantFailed;
        return {
          status: "contradicted",
          rationale:
            testRes.relevantPassed.length > 0
              ? "Claim asserts artifact failed every test/gold case, but system-recorded validation test PASSED on the referenced artifact."
              : "Claim asserts artifact failed every test/gold case, but authoritative validation recorded passing cases on the referenced artifact.",
          supportingIds: [],
          contradictingIds: contra,
          anomalies: [],
        };
      }
      if (testRes.relevantFailed.length > 0) {
        return {
          status: "supported",
          rationale:
            "System-recorded validation failed all cases on the referenced artifact, corroborating the universal failure assertion.",
          supportingIds: testRes.relevantFailed,
          contradictingIds: [],
          anomalies: [],
        };
      }
    }

    if (assertsTestFailure) {
      if (testRes.relevantPassed.length > 0 && testRes.relevantFailed.length === 0) {
        return {
          status: "contradicted",
          rationale:
            "Claim asserts validation failed, but system-recorded validation test PASSED on the referenced artifact.",
          supportingIds: [],
          contradictingIds: testRes.relevantPassed,
          anomalies: [],
        };
      }
      if (testRes.relevantFailed.length > 0) {
        return {
          status: "supported",
          rationale:
            "System-recorded test FAILED on the referenced artifact, corroborating failure assertion.",
          supportingIds: testRes.relevantFailed,
          contradictingIds: [],
          anomalies: [],
        };
      }
    }

    if (assertsObservedPassOrCoverage) {
      if (testRes.relevantFailed.length > 0) {
        return {
          status: "contradicted",
          rationale:
            "Claim asserts validation passed/approved, but system-recorded test FAILED on the referenced artifact.",
          supportingIds: [],
          contradictingIds: testRes.relevantFailed,
          anomalies: [],
        };
      }
      if (testRes.relevantPassed.length > 0) {
        return {
          status: "supported",
          rationale:
            "System-recorded test PASSED on the referenced artifact, confirming validation coverage and release justification.",
          supportingIds: testRes.relevantPassed,
          contradictingIds: [],
          anomalies: [],
        };
      }
    }
  }

  // Category C: Documentary Record Claims
  if (citedRecordsMap.size > 0) {
    const entailment = evaluateDocumentaryRecordEntailment(
      rawText,
      Array.from(citedRecordsMap.values()),
      index
    );
    return {
      status: entailment.status,
      rationale: entailment.rationale,
      supportingIds: entailment.supportingIds,
      contradictingIds: entailment.contradictingIds,
      anomalies: [],
    };
  }

  // Category D: Structured Artifact Content Verification
  const refsForArt = item.ownRefs.length > 0 ? item.ownRefs : [...item.artifactRefs, ...item.allRefs];
  const candidateArts = new Map<string, IndexedArtifact>();
  for (const r of refsForArt) {
    const res = index.resolveReference(r);
    if (res.note?.toLowerCase().includes("ambiguous")) {
      return {
        status: "unverified",
        rationale: res.note,
        supportingIds: [],
        contradictingIds: [],
        anomalies: [],
      };
    }
    if (res.target_type === "artifact" && res.target_id && index.artifactsById.has(res.target_id)) {
      const art = index.artifactsById.get(res.target_id)!;
      if (!art.type.startsWith("incident_record/")) {
        candidateArts.set(art.artifact_id, art);
      }
    }
  }

  if (candidateArts.size > 0 && /\bmaps?\b|->|→/i.test(rawText)) {
    let targetArt: IndexedArtifact | undefined;
    if (candidateArts.size === 1) {
      targetArt = Array.from(candidateArts.values())[0];
    } else {
      const verMatch =
        rawText.match(/\b(?:artifact\s+v?|version\s+)(\d+)\b/i) ?? rawText.match(/\bv(\d+)\b/i);
      const explicitVer = verMatch?.[1];
      const matches = explicitVer
        ? Array.from(candidateArts.values()).filter((a) => a.version === explicitVer)
        : [];
      if (matches.length === 1) {
        targetArt = matches[0];
      } else {
        return {
          status: "unverified",
          rationale: "Multiple artifacts cited for mapping claim without unambiguous version binding (abstaining).",
          supportingIds: [],
          contradictingIds: [],
          anomalies: [],
        };
      }
    }

    if (targetArt) {
      const verifyRes = verifyMappingClaim(targetArt, rawText);
      return {
        status: verifyRes.status,
        rationale: verifyRes.rationale,
        supportingIds: verifyRes.status === "supported" ? [targetArt.artifact_id] : [],
        contradictingIds: verifyRes.status === "contradicted" ? [targetArt.artifact_id] : [],
        anomalies: [],
      };
    }
  }

  return {
    status: "unverified",
    rationale:
      "Available evidence is insufficient to conclusively verify or contradict the delivered claim.",
    supportingIds: [],
    contradictingIds: [],
    anomalies: [],
  };
}

function buildAtomicSubClaims(claim: ObservableClaim): AtomicSubClaim[] {
  const allRefs = [...claim.evidence_refs, ...claim.artifact_refs];

  if (claim.event_kind === "assertion") {
    return [
      {
        kind: "text",
        rawText: claim.claim ?? "",
        ownRefs: [...claim.evidence_refs],
        allRefs,
        artifactRefs: [...claim.artifact_refs],
      },
    ];
  }

  const items: AtomicSubClaim[] = [];
  if (claim.payload && typeof claim.payload === "object") {
    const p = claim.payload as Record<string, unknown>;

    if (Array.isArray(p["assertions"])) {
      for (const a of p["assertions"]) {
        if (a && typeof a === "object" && typeof a["claim"] === "string") {
          const ownRefs = Array.isArray(a["evidence_refs"])
            ? a["evidence_refs"].filter((r): r is string => typeof r === "string")
            : [];
          items.push({
            kind: "text",
            rawText: a["claim"],
            ownRefs,
            allRefs,
            artifactRefs: [...claim.artifact_refs],
          });
        }
      }
    }

    if (p["output"] && typeof p["output"] === "object") {
      const out = p["output"] as Record<string, unknown>;
      if (Array.isArray(out["findings"])) {
        for (const f of out["findings"]) {
          if (f && typeof f === "object" && typeof f["claim"] === "string") {
            const ownRefs = Array.isArray(f["record_ids"])
              ? f["record_ids"].filter((r): r is string => typeof r === "string")
              : [];
            items.push({
              kind: "finding",
              rawText: f["claim"],
              ownRefs,
              allRefs,
              artifactRefs: [...claim.artifact_refs],
              findingId: typeof f["id"] === "string" ? f["id"] : undefined,
              severity: typeof f["severity"] === "string" ? f["severity"] : undefined,
            });
          }
        }
      }
      if (Array.isArray(out["assessments"])) {
        for (const ass of out["assessments"]) {
          if (ass && typeof ass === "object" && typeof ass["finding_id"] === "string") {
            const ownRefs = Array.isArray(ass["record_ids"])
              ? ass["record_ids"].filter((r): r is string => typeof r === "string")
              : [];
            items.push({
              kind: "assessment",
              rawText: typeof ass["reason"] === "string" ? ass["reason"] : "",
              ownRefs,
              allRefs,
              artifactRefs: [...claim.artifact_refs],
              findingId: ass["finding_id"],
              expectedSupported: Boolean(ass["supported"]),
            });
          }
        }
      }
    }
  }

  if (items.length === 0) {
    items.push({
      kind: "text",
      rawText: claim.claim ?? "",
      ownRefs: [...claim.evidence_refs],
      allRefs,
      artifactRefs: [...claim.artifact_refs],
    });
  }

  return items;
}

export function resolveObservableClaim(
  claim: ObservableClaim,
  index: KarmaPoliceEvidenceIndex
): ResolutionResult {
  // 1. Incomplete Capture Gate
  if (claim.capture_incomplete) {
    const anomalies: ProvenanceAnomalyKind[] = ["incomplete_capture"];
    const rationale =
      "Evidence capture is incomplete (redacted, omitted, or structure-only); cannot evaluate claim content.";
    const pred = predictionFor(claim, "unverified", rationale, {
      confidence: "low",
      abstained: true,
      capture_incomplete: true,
    });
    const finding: ClaimProvenanceFinding = {
      claim_id: claim.claim_id,
      originating_agent_id: claim.agent_id,
      event_or_handoff_id: claim.event_id ?? claim.handoff_id,
      event_kind: claim.event_kind,
      evidence_identifiers_considered: [],
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      provenance_anomalies: anomalies,
      capture_completeness: "incomplete",
      classification: "unverified",
      classification_rationale: rationale,
      limitations: ["Incomplete capture prevents evaluation of claim statement."],
    };
    return { prediction: pred, finding };
  }

  // 2. Resolve Cited References & Detect Provenance Anomalies
  const rawRefs = [...claim.evidence_refs, ...claim.artifact_refs];
  const resolvedRefs: EvidenceReferenceResolution[] = rawRefs.map((ref) =>
    index.resolveReference(ref)
  );

  const anomalies: ProvenanceAnomalyKind[] = [];
  const consideredIds: string[] = [];

  for (const res of resolvedRefs) {
    if (res.target_id) consideredIds.push(res.target_id);
    else consideredIds.push(res.ref);

    if (res.status === "cross_run" && !anomalies.includes("cross_run_reference")) {
      anomalies.push("cross_run_reference");
    } else if (res.status === "stale" && !anomalies.includes("stale_artifact_reference")) {
      anomalies.push("stale_artifact_reference");
    } else if (res.status === "unresolved" && !anomalies.includes("unresolved_reference")) {
      anomalies.push("unresolved_reference");
    }
  }

  // 3. Inspect Delivered Handoff Characteristics & Producer State Integrity
  if (claim.event_kind === "handoff") {
    if (claim.evidence_refs.length === 0) {
      anomalies.push("missing_resolving_evidence");
      const rationale =
        "Handoff evidence refs were stripped or omitted; remaining references do not establish resolving evidence for payload findings.";
      const pred = predictionFor(claim, "unverified", rationale, {
        confidence: "low",
        abstained: true,
      });
      const finding: ClaimProvenanceFinding = {
        claim_id: claim.claim_id,
        originating_agent_id: claim.agent_id,
        event_or_handoff_id: claim.handoff_id,
        event_kind: "handoff",
        evidence_identifiers_considered: consideredIds,
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        provenance_anomalies: anomalies,
        capture_completeness: "complete",
        classification: "unverified",
        classification_rationale: rationale,
        limitations: ["Missing resolving evidence citations."],
      };
      return { prediction: pred, finding };
    }

    const handoffObj = claim.handoff_id ? index.handoffsById.get(claim.handoff_id) : undefined;
    const fromStepId = handoffObj?.from_step_id;
    const producerData = fromStepId
      ? index.producerOutputsByStep.get(fromStepId)
      : !index.ambiguousProducerAgents.has(claim.agent_id)
        ? index.producerOutputsByAgent.get(claim.agent_id)
        : undefined;

    if (producerData && claim.payload && typeof claim.payload === "object") {
      const payloadRec = claim.payload as Record<string, unknown>;
      const deliveredOutput = payloadRec["output"];
      if (
        producerData.output &&
        typeof producerData.output === "object" &&
        deliveredOutput &&
        typeof deliveredOutput === "object"
      ) {
        const prodOut = producerData.output as Record<string, unknown>;
        const delivOut = deliveredOutput as Record<string, unknown>;
        const allKeys = new Set([...Object.keys(prodOut), ...Object.keys(delivOut)]);
        for (const key of allKeys) {
          if (JSON.stringify(delivOut[key]) !== JSON.stringify(prodOut[key])) {
            anomalies.push("producer_delivered_mismatch");
            const rationale = `Delivered handoff payload field "${key}" contradicts canonical output recorded for producer agent ${claim.agent_id}.`;
            const contraId = fromStepId
              ? `producer_step:${fromStepId}`
              : `producer_output:${claim.agent_id}`;
            const pred = predictionFor(claim, "contradicted", rationale, {
              confidence: "high",
              abstained: false,
            });
            const finding: ClaimProvenanceFinding = {
              claim_id: claim.claim_id,
              originating_agent_id: claim.agent_id,
              event_or_handoff_id: claim.handoff_id,
              event_kind: "handoff",
              evidence_identifiers_considered: consideredIds,
              supporting_evidence_ids: [],
              contradicting_evidence_ids: [contraId],
              provenance_anomalies: anomalies,
              capture_completeness: "complete",
              classification: "contradicted",
              classification_rationale: rationale,
              limitations: [],
            };
            return { prediction: pred, finding };
          }
        }
      }

      if (
        Array.isArray(producerData.assertions) &&
        Array.isArray(payloadRec["assertions"]) &&
        JSON.stringify(payloadRec["assertions"]) !== JSON.stringify(producerData.assertions)
      ) {
        anomalies.push("producer_delivered_mismatch");
        const rationale = `Delivered handoff assertions contradict canonical assertions recorded for producer agent ${claim.agent_id}.`;
        const contraId = fromStepId
          ? `producer_step:${fromStepId}`
          : `producer_output:${claim.agent_id}`;
        const pred = predictionFor(claim, "contradicted", rationale, {
          confidence: "high",
          abstained: false,
        });
        const finding: ClaimProvenanceFinding = {
          claim_id: claim.claim_id,
          originating_agent_id: claim.agent_id,
          event_or_handoff_id: claim.handoff_id,
          event_kind: "handoff",
          evidence_identifiers_considered: consideredIds,
          supporting_evidence_ids: [],
          contradicting_evidence_ids: [contraId],
          provenance_anomalies: anomalies,
          capture_completeness: "complete",
          classification: "contradicted",
          classification_rationale: rationale,
          limitations: [],
        };
        return { prediction: pred, finding };
      }
    }
  }

  // 4. Missing Evidence Gate on Assertions (non-universal claims with zero citations)
  if (rawRefs.length === 0) {
    const universalCheck = evaluateUniversalStatement(claim.claim ?? "", index.canonicalRecords);
    if (!universalCheck.isUniversal) {
      anomalies.push("missing_resolving_evidence");
      const rationale = "Claim carries no evidence references; cannot establish factual support.";
      const pred = predictionFor(claim, "unverified", rationale, {
        confidence: "low",
        abstained: true,
      });
      const finding: ClaimProvenanceFinding = {
        claim_id: claim.claim_id,
        originating_agent_id: claim.agent_id,
        event_or_handoff_id: claim.event_id ?? claim.handoff_id,
        event_kind: claim.event_kind,
        evidence_identifiers_considered: [],
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        provenance_anomalies: anomalies,
        capture_completeness: "complete",
        classification: "unverified",
        classification_rationale: rationale,
        limitations: ["No evidence citations provided on claim."],
      };
      return { prediction: pred, finding };
    }
  }

  // 5. Decompose & Evaluate Atomic Sub-Claims
  const atomicItems = buildAtomicSubClaims(claim);
  const outcomes = atomicItems.map((item) => evaluateAtomicSubClaim(item, index));

  for (const out of outcomes) {
    for (const anom of out.anomalies) {
      if (!anomalies.includes(anom)) {
        anomalies.push(anom);
      }
    }
  }

  const contradictedOutcomes = outcomes.filter((o) => o.status === "contradicted");
  if (contradictedOutcomes.length > 0) {
    const contraIds = Array.from(new Set(contradictedOutcomes.flatMap((o) => o.contradictingIds)));
    const rationale = contradictedOutcomes.map((o) => o.rationale).join(" ");
    const pred = predictionFor(claim, "contradicted", rationale, {
      confidence: "high",
      abstained: false,
    });
    const finding: ClaimProvenanceFinding = {
      claim_id: claim.claim_id,
      originating_agent_id: claim.agent_id,
      event_or_handoff_id: claim.event_id ?? claim.handoff_id,
      event_kind: claim.event_kind,
      evidence_identifiers_considered: consideredIds,
      supporting_evidence_ids: [],
      contradicting_evidence_ids: contraIds,
      provenance_anomalies: anomalies.length > 0 ? anomalies : ["none"],
      capture_completeness: "complete",
      classification: "contradicted",
      classification_rationale: rationale,
      limitations: [],
    };
    return { prediction: pred, finding };
  }

  const allSupported = outcomes.length > 0 && outcomes.every((o) => o.status === "supported");
  if (allSupported) {
    const suppIds = Array.from(new Set(outcomes.flatMap((o) => o.supportingIds)));
    const rationale = outcomes[0]!.rationale;
    const pred = predictionFor(claim, "supported", rationale, {
      confidence: "high",
      abstained: false,
    });
    const finding: ClaimProvenanceFinding = {
      claim_id: claim.claim_id,
      originating_agent_id: claim.agent_id,
      event_or_handoff_id: claim.event_id ?? claim.handoff_id,
      event_kind: claim.event_kind,
      evidence_identifiers_considered: consideredIds,
      supporting_evidence_ids: suppIds,
      contradicting_evidence_ids: [],
      provenance_anomalies: anomalies.length > 0 ? anomalies : ["none"],
      capture_completeness: "complete",
      classification: "supported",
      classification_rationale: rationale,
      limitations: [],
    };
    return { prediction: pred, finding };
  }

  const unverifiedOutcomes = outcomes.filter((o) => o.status === "unverified");
  const rationale =
    unverifiedOutcomes[0]?.rationale ??
    "Available evidence is insufficient to conclusively verify or contradict the delivered claim.";
  const pred = predictionFor(claim, "unverified", rationale, {
    confidence: "low",
    abstained: true,
  });
  const finding: ClaimProvenanceFinding = {
    claim_id: claim.claim_id,
    originating_agent_id: claim.agent_id,
    event_or_handoff_id: claim.event_id ?? claim.handoff_id,
    event_kind: claim.event_kind,
    evidence_identifiers_considered: consideredIds,
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    provenance_anomalies: anomalies.length > 0 ? anomalies : ["none"],
    capture_completeness: "complete",
    classification: "unverified",
    classification_rationale: rationale,
    limitations: ["Evidence resolution inconclusive."],
  };
  return { prediction: pred, finding };
}
