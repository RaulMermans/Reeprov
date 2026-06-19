import type { WorkflowSpec } from "@/lib/proof-layer/schemas";

export const BLOG_AGENT_PROJECT_ID = "blog-agent";
export const BLOG_AGENT_WORKFLOW_ID = "blog-agent-v1";

export const BLOG_AGENT_STAGE_ORDER = [
  "intake_request_parsing",
  "generate_research_questions",
  "topic_product_research",
  "extract_webpages",
  "score_sources",
  "outline_generation",
  "draft_writing",
  "seo_optimization",
  "reviewer_critic_pass",
  "final_article_packaging",
] as const;

const blogAgentNodes: WorkflowSpec["nodes"] = [
  {
    id: "intake_request_parsing",
    type: "trigger",
    label: "Intake Request Parsing",
    description: "Validates and normalizes the requested article topic, audience, and constraints.",
    stage_category: "intake",
    expected_inputs: ["article request"],
    expected_outputs: ["normalized content brief"],
    risk_gates: ["reject malformed or unsupported requests"],
  },
  {
    id: "generate_research_questions",
    type: "llm",
    label: "Generate Research Questions",
    description: "Creates the research questions needed to support the article.",
    stage_category: "planning",
    expected_inputs: ["normalized content brief"],
    expected_outputs: ["research questions"],
    quality_gates: ["questions cover topic intent and audience needs"],
  },
  {
    id: "topic_product_research",
    type: "retrieval",
    label: "Topic and Product Research",
    description: "Collects topic, product, and competitor evidence.",
    stage_category: "research",
    expected_inputs: ["research questions"],
    expected_outputs: ["candidate sources and research notes"],
    risk_gates: ["use read-only research tools"],
  },
  {
    id: "extract_webpages",
    type: "tool",
    label: "Extract Webpages",
    description: "Extracts relevant content from candidate webpages.",
    stage_category: "research",
    expected_inputs: ["candidate source URLs"],
    expected_outputs: ["structured webpage extracts"],
    risk_gates: ["exclude unsafe or inaccessible sources"],
  },
  {
    id: "score_sources",
    type: "evaluator",
    label: "Score Sources",
    description: "Scores source relevance, authority, and evidence quality.",
    stage_category: "quality",
    expected_inputs: ["structured webpage extracts"],
    expected_outputs: ["ranked source set"],
    quality_gates: ["minimum source relevance and authority thresholds"],
  },
  {
    id: "outline_generation",
    type: "llm",
    label: "Outline Generation",
    description: "Builds an evidence-backed article outline.",
    stage_category: "planning",
    expected_inputs: ["content brief", "ranked source set"],
    expected_outputs: ["article outline"],
    quality_gates: ["outline covers required sections and search intent"],
  },
  {
    id: "draft_writing",
    type: "llm",
    label: "Draft Writing",
    description: "Writes the article draft from the approved outline and evidence.",
    stage_category: "generation",
    expected_inputs: ["article outline", "ranked source set"],
    expected_outputs: ["article draft"],
    quality_gates: ["claims remain grounded in selected sources"],
  },
  {
    id: "seo_optimization",
    type: "llm",
    label: "SEO Optimization",
    description: "Improves search structure, metadata, headings, and keyword coverage.",
    stage_category: "optimization",
    expected_inputs: ["article draft"],
    expected_outputs: ["SEO-optimized draft"],
    quality_gates: ["preserve readability and factual meaning"],
  },
  {
    id: "reviewer_critic_pass",
    type: "evaluator",
    label: "Reviewer and Critic Pass",
    description: "Reviews the draft for factual, editorial, and quality issues.",
    stage_category: "quality",
    expected_inputs: ["SEO-optimized draft", "ranked source set"],
    expected_outputs: ["reviewed article", "review findings"],
    quality_gates: ["factual grounding", "editorial quality", "publish readiness"],
  },
  {
    id: "final_article_packaging",
    type: "artifact",
    label: "Final Article Packaging",
    description: "Packages the final article and supporting metadata.",
    stage_category: "delivery",
    expected_inputs: ["reviewed article"],
    expected_outputs: ["article markdown", "article metadata"],
    risk_gates: ["do not publish externally without an explicit approval policy"],
  },
];

export const BLOG_AGENT_WORKFLOW_SPEC: WorkflowSpec = {
  project_id: BLOG_AGENT_PROJECT_ID,
  workflow_id: BLOG_AGENT_WORKFLOW_ID,
  name: "BlogAgent v1",
  version: "1",
  description: "Researches, drafts, reviews, optimizes, and packages a source-grounded blog article.",
  architecture_type: "deterministic_workflow",
  nodes: blogAgentNodes,
  expected_order: [...BLOG_AGENT_STAGE_ORDER],
  edges: BLOG_AGENT_STAGE_ORDER.slice(0, -1).map((nodeId, index) => ({
    from: nodeId,
    to: BLOG_AGENT_STAGE_ORDER[index + 1]!,
  })),
  allowed_tools: ["web research", "webpage extraction"],
  evals: ["source quality", "factual grounding", "editorial quality", "SEO quality"],
  risk_gates: ["read-only research", "no external publication without approval"],
  quality_gates: ["source quality", "factual grounding", "publish readiness"],
  artifacts: ["article markdown", "article metadata"],
};

const BUILT_IN_WORKFLOW_SPECS: WorkflowSpec[] = [BLOG_AGENT_WORKFLOW_SPEC];

export function listBuiltInWorkflowSpecs(): WorkflowSpec[] {
  return [...BUILT_IN_WORKFLOW_SPECS];
}

export function getBuiltInWorkflowSpec(
  projectId: string,
  workflowId: string,
): WorkflowSpec | undefined {
  return BUILT_IN_WORKFLOW_SPECS.find(
    (spec) => spec.project_id === projectId && spec.workflow_id === workflowId,
  );
}
