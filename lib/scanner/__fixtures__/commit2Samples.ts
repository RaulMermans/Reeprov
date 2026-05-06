export const commit2ScannerFixtureFiles = [
  {
    path: "AGENTS.md",
    size: 220,
    content: "Agent policy and repository instructions. This is documentation, not an agent config.",
  },
  {
    path: "agents.yaml",
    size: 80,
    content: "agents:\n  - name: support-agent\n    tools:\n      - create_issue",
  },
  {
    path: ".env",
    size: 48,
    content: "OPENAI_API_KEY=sk-fixture-should-not-be-scanned",
  },
  {
    path: "tools/issues.ts",
    size: 130,
    content: "export const tool = { name: 'create_issue', description: 'Opens an issue' };",
  },
  {
    path: "docs/authoring.md",
    size: 90,
    content: "Use the UI to create and update documentation pages during normal authoring.",
  },
];

export const commit2ScannerFixtureExpectations = {
  agentsMdClassification: "documentation",
  agentsYamlClassification: "agent_config",
  envIgnored: true,
  writeToolFinding: "write-tools-without-approval",
  docsCreateMentionDoesNotTriggerWriteToolRisk: true,
};
