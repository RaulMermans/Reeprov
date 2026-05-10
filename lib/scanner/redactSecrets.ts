import { looksLikeCredentialValue, secretPatterns } from "./secretPatterns";
import type { SecretMatch } from "./secretPatterns";

export interface RedactionResult {
  content: string;
  redacted: boolean;
  matches: string[];
  secretMatches: SecretMatch[];
}

export function redactSecrets(content = ""): RedactionResult {
  // Process patterns from most specific to least specific so that, for
  // example, sk-ant- is consumed before the broader sk- pattern fires.
  let next = content;
  const matchedKinds = new Set<string>();
  const secretMatchList: SecretMatch[] = [];

  for (const pattern of secretPatterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

    next = next.replace(regex, (fullMatch: string) => {
      // For medium-confidence patterns, check whether the captured value
      // actually looks like a credential before redacting.
      if (pattern.confidence === "medium") {
        // Extract the value portion after the `=` sign.
        const eqIndex = fullMatch.indexOf("=");
        const rawValue = eqIndex >= 0 ? fullMatch.slice(eqIndex + 1).replace(/^["'\s]+|["'\s]+$/g, "") : fullMatch;
        if (!looksLikeCredentialValue(rawValue)) {
          return fullMatch; // not a real secret, skip
        }
      }

      if (!matchedKinds.has(pattern.name)) {
        matchedKinds.add(pattern.name);
        const preview = fullMatch.length > 60 ? `${fullMatch.slice(0, 57)}...` : fullMatch;
        secretMatchList.push({
          kind: pattern.name,
          confidence: pattern.confidence,
          reason: reasonFor(pattern.name),
          matchedPreview: preview,
        });
      }

      return `[REDACTED:${pattern.name}]`;
    });
  }

  return {
    content: next,
    redacted: matchedKinds.size > 0,
    // Legacy field: list of matched pattern names for backward compat.
    matches: [...matchedKinds],
    secretMatches: secretMatchList,
  };
}

function reasonFor(patternName: string): string {
  const reasons: Record<string, string> = {
    "Anthropic API key": "Value matches sk-ant-... credential format",
    "OpenAI API key": "Value matches sk-... credential format",
    "GitHub fine-grained token": "Value matches github_pat_... token format",
    "GitHub token": "Value matches ghp_... token format",
    "AWS access key": "Value matches AKIA... AWS access key format",
    "Database URL": "Value is a database connection URL containing credentials",
    "Private key block": "PEM private key block detected",
    "API key assignment": "Variable named *API_KEY with a long, high-entropy value",
    "Secret assignment": "Variable named *SECRET* with a long, high-entropy value",
    "Token assignment": "Variable named *ACCESS_TOKEN* with a long, high-entropy value",
    "Password assignment": "Variable named *PASSWORD* with a long, high-entropy value",
  };
  return reasons[patternName] ?? "Pattern matched a potential secret";
}
