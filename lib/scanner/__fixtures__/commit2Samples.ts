export const commit2ScannerFixtureFiles = [
  {
    path: "AGENTS.md",
    size: 220,
    content: "Agent policy and repository instructions. This is documentation, not an agent config.",
  },
  {
    path: "CLAUDE.md",
    size: 180,
    content: "Claude Code memory for the repository. This is documentation, not an agent config.",
  },
  {
    path: "agents.yaml",
    size: 80,
    content: "agents:\n  - name: support-agent\n    tools:\n      - create_issue",
  },
  {
    path: ".env.local",
    size: 48,
    content: "OPENAI_API_KEY=sk-fixture-should-not-be-scanned",
  },
  {
    path: "tools/email.ts",
    size: 130,
    content: "export const tool = { name: 'send_email', description: 'Sends a message' };",
  },
  {
    path: "docs/setup.md",
    size: 90,
    content: "Use the UI to create and update documentation pages during normal authoring.",
  },
  {
    path: "config/keys.ts",
    size: 110,
    content: "export const ANTHROPIC_API_KEY = 'sk-ant-abcdefghijklmnopqrstuvwxyz';",
  },
];

export const commit2ScannerFixtureExpectations = {
  agentsMdClassification: "documentation",
  claudeMdClassification: "documentation",
  agentsYamlClassification: "agent_config",
  envIgnored: true,
  writeToolFinding: "write-tools-without-approval",
  docsCreateMentionDoesNotTriggerWriteToolRisk: true,
  anthropicPattern: "Anthropic API key",
  notOpenAiPatternForAnthropicKey: true,
};
