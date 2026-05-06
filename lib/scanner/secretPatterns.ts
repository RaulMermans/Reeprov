export interface SecretPattern {
  name: string;
  regex: RegExp;
}

export const secretPatterns: SecretPattern[] = [
  { name: "Anthropic API key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI API key", regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "GitHub token", regex: /ghp_[A-Za-z0-9_]{20,}/g },
  { name: "GitHub fine-grained token", regex: /github_pat_[A-Za-z0-9_]{40,}/g },
  {
    name: "Database URL",
    regex: /(postgres|postgresql|mysql|mongodb|redis):\/\/[^\s"'`]+/gi,
  },
  {
    name: "Private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    name: "API key assignment",
    regex: /\b[A-Z0-9_]*API[_-]?KEY\s*=\s*["']?[^"'\n\r]+["']?/gi,
  },
  {
    name: "Secret assignment",
    regex: /\b[A-Z0-9_]*SECRET[A-Z0-9_]*\s*=\s*["']?[^"'\n\r]+["']?/gi,
  },
  {
    name: "Token assignment",
    regex: /\b[A-Z0-9_]*TOKEN[A-Z0-9_]*\s*=\s*["']?[^"'\n\r]+["']?/gi,
  },
  {
    name: "Password assignment",
    regex: /\b[A-Z0-9_]*PASSWORD[A-Z0-9_]*\s*=\s*["']?[^"'\n\r]+["']?/gi,
  },
];
