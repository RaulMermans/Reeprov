import { secretPatterns } from "./secretPatterns";

export interface RedactionResult {
  content: string;
  redacted: boolean;
  matches: string[];
}

export function redactSecrets(content = ""): RedactionResult {
  let next = content;
  const matches = new Set<string>();

  for (const pattern of secretPatterns) {
    next = next.replace(pattern.regex, () => {
      matches.add(pattern.name);
      return `[REDACTED:${pattern.name}]`;
    });
  }

  return {
    content: next,
    redacted: matches.size > 0,
    matches: [...matches],
  };
}
