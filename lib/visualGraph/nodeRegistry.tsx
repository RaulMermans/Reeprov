/**
 * Visual node type registry.
 *
 * Maps every VisualNodeType/VisualNodeStatus to display metadata (label,
 * icon, color treatment, inspector grouping) so the canvas and inspector
 * never hard-code per-type styling inline. Generic — no project or
 * workflow branching.
 */

import {
  Layers,
  Bot,
  BrainCircuit,
  Wrench,
  Sparkles,
  Terminal,
  ShieldCheck,
  Package,
  AlertTriangle,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import type { VisualNodeType, VisualNodeStatus } from "@/lib/visualGraph/types";

export interface VisualNodeTypeDefinition {
  type: VisualNodeType;
  /** Singular display label, e.g. "Model". */
  label: string;
  /** Plural label used for evidence-count pills, e.g. "Models". */
  pluralLabel: string;
  icon: LucideIcon;
  /** Tailwind text color class for the icon/accent. */
  accentClass: string;
  /** Tailwind background color class for chips/pills of this type. */
  bgClass: string;
  /** Tailwind border color class. */
  borderClass: string;
  /** Whether this type renders on the primary canvas path or as attached evidence. */
  inspectorGroup: "primary" | "evidence";
}

export const VISUAL_NODE_REGISTRY: Record<VisualNodeType, VisualNodeTypeDefinition> = {
  stage: {
    type: "stage",
    label: "Stage",
    pluralLabel: "Stages",
    icon: Layers,
    accentClass: "text-slate-600",
    bgClass: "bg-slate-50",
    borderClass: "border-slate-300",
    inspectorGroup: "primary",
  },
  agent: {
    type: "agent",
    label: "Agent",
    pluralLabel: "Agents",
    icon: Bot,
    accentClass: "text-indigo-600",
    bgClass: "bg-indigo-50",
    borderClass: "border-indigo-300",
    inspectorGroup: "primary",
  },
  model: {
    type: "model",
    label: "Model",
    pluralLabel: "Models",
    icon: BrainCircuit,
    accentClass: "text-sky-600",
    bgClass: "bg-sky-50",
    borderClass: "border-sky-300",
    inspectorGroup: "evidence",
  },
  tool: {
    type: "tool",
    label: "Tool",
    pluralLabel: "Tools",
    icon: Wrench,
    accentClass: "text-violet-600",
    bgClass: "bg-violet-50",
    borderClass: "border-violet-300",
    inspectorGroup: "evidence",
  },
  skill: {
    type: "skill",
    label: "Skill",
    pluralLabel: "Skills",
    icon: Sparkles,
    accentClass: "text-purple-600",
    bgClass: "bg-purple-50",
    borderClass: "border-purple-300",
    inspectorGroup: "evidence",
  },
  cli: {
    type: "cli",
    label: "CLI",
    pluralLabel: "CLI",
    icon: Terminal,
    accentClass: "text-slate-600",
    bgClass: "bg-slate-100",
    borderClass: "border-slate-300",
    inspectorGroup: "evidence",
  },
  eval: {
    type: "eval",
    label: "Eval",
    pluralLabel: "Evals",
    icon: ShieldCheck,
    accentClass: "text-teal-600",
    bgClass: "bg-teal-50",
    borderClass: "border-teal-300",
    inspectorGroup: "evidence",
  },
  artifact: {
    type: "artifact",
    label: "Artifact",
    pluralLabel: "Artifacts",
    icon: Package,
    accentClass: "text-amber-600",
    bgClass: "bg-amber-50",
    borderClass: "border-amber-300",
    inspectorGroup: "evidence",
  },
  issue: {
    type: "issue",
    label: "Issue",
    pluralLabel: "Issues",
    icon: AlertTriangle,
    accentClass: "text-red-600",
    bgClass: "bg-red-50",
    borderClass: "border-red-300",
    inspectorGroup: "evidence",
  },
  recovery: {
    type: "recovery",
    label: "Recovery",
    pluralLabel: "Recoveries",
    icon: RefreshCw,
    accentClass: "text-emerald-600",
    bgClass: "bg-emerald-50",
    borderClass: "border-emerald-300",
    inspectorGroup: "evidence",
  },
};

export interface VisualStatusDefinition {
  label: string;
  dotClass: string;
  borderClass: string;
  badgeTone: "success" | "warning" | "danger" | "info" | "neutral";
}

export const VISUAL_STATUS_REGISTRY: Record<VisualNodeStatus, VisualStatusDefinition> = {
  completed: { label: "Completed", dotClass: "bg-emerald-500", borderClass: "border-l-emerald-500", badgeTone: "success" },
  warning: { label: "Warning", dotClass: "bg-amber-400", borderClass: "border-l-amber-400", badgeTone: "warning" },
  failed: { label: "Failed", dotClass: "bg-red-500", borderClass: "border-l-red-500", badgeTone: "danger" },
  running: { label: "In progress", dotClass: "bg-sky-500", borderClass: "border-l-sky-500", badgeTone: "info" },
  recovered: { label: "Recovered", dotClass: "bg-emerald-400", borderClass: "border-l-emerald-400", badgeTone: "success" },
  not_observed: { label: "Not observed", dotClass: "bg-slate-300", borderClass: "border-l-slate-300", badgeTone: "neutral" },
};

export function visualNodeTypeDefinition(type: VisualNodeType): VisualNodeTypeDefinition {
  return VISUAL_NODE_REGISTRY[type];
}

export function visualNodeStatusDefinition(status: VisualNodeStatus): VisualStatusDefinition {
  return VISUAL_STATUS_REGISTRY[status];
}

/** Readable evidence-count label, e.g. "Models 3" — never an abbreviation like "m" or "$". */
export function evidenceCountLabel(type: VisualNodeType, count: number): string {
  return `${VISUAL_NODE_REGISTRY[type].pluralLabel} ${count}`;
}
