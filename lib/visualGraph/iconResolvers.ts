import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCheck,
  Code2,
  Database,
  File,
  FileImage,
  FileJson,
  FileText,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  type LucideIcon,
  Package,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import type { VisualNode } from "@/lib/visualGraph/types";

export function visualNodeIcon(node: VisualNode): LucideIcon {
  if (node.type === "stage") return Layers;
  if (node.type === "agent") return Bot;
  if (node.type === "model") return BrainCircuit;
  if (node.type === "skill") return Sparkles;
  if (node.type === "cli") return Terminal;
  if (node.type === "issue") return AlertTriangle;
  if (node.type === "recovery") return RefreshCw;
  if (node.type === "eval") {
    if (node.identity.evalSubtype === "contract") return CheckCheck;
    return ShieldCheck;
  }
  if (node.type === "artifact") {
    switch (node.identity.artifactType) {
      case "markdown":
      case "report":
        return FileText;
      case "json":
        return FileJson;
      case "image":
        return FileImage;
      case "dataset":
        return Database;
      case "file":
      case "unknown_artifact":
      default:
        return File;
    }
  }
  if (node.type === "tool") {
    switch (node.identity.toolSubtype) {
      case "web_search":
        return Search;
      case "webpage_extract":
      case "scraper":
        return Globe;
      case "browser":
        return Globe;
      case "filesystem":
        return HardDrive;
      case "database":
        return Database;
      case "github":
        return GitBranch;
      case "http_api":
        return ServerCog;
      case "validator":
        return Code2;
      case "unknown_tool":
      default:
        return Wrench;
    }
  }
  return Package;
}
