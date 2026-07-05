import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(fileURLToPath(import.meta.url), "../../../");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function walk(dir: string, matches: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git" || entry === ".agentpulse") continue;
    const full = path.join(dir, entry);
    const relative = path.relative(root, full);
    if (statSync(full).isDirectory()) {
      walk(full, matches);
      continue;
    }
    if (/ [23]\.(ts|tsx)$/.test(relative)) matches.push(relative);
  }
  return matches;
}

describe("canvas usability hardening source contract", () => {
  const canvas = read("components/proof-layer/VisualExecutionCanvas.tsx");

  it("keeps fit-view controls while defaulting to the readable viewport policy", () => {
    expect(canvas).toContain("<Controls showInteractive={false}");
    expect(canvas).toContain("initialViewportPlan(filteredGraph)");
    expect(canvas).toContain("minZoom: plan.minZoom");
  });

  it("supports deterministic active-node follow and manual follow pause", () => {
    expect(canvas).toContain("shouldFocusActiveNode({");
    expect(canvas).toContain("onMoveStart={handleManualViewportMove}");
    expect(canvas).toContain("data-testid=\"replay-follow-toggle\"");
    expect(canvas).toContain("data-testid=\"live-follow-toggle\"");
  });

  it("has a collapsible registry-driven legend", () => {
    expect(canvas).toContain("const [open, setOpen] = useState(false)");
    expect(canvas).toContain("data-testid=\"canvas-legend-toggle\"");
    expect(canvas).toContain("data-testid=\"canvas-legend-content\"");
    expect(canvas).toContain("Object.values(VISUAL_NODE_REGISTRY)");
  });

  it("keeps the minimap visible with contrast polish", () => {
    expect(canvas).toContain("<MiniMap pannable zoomable");
    expect(canvas).toContain("maskColor=\"rgba(15, 23, 42, 0.08)\"");
  });

  it("respects prefers-reduced-motion for the active-node camera pan", () => {
    expect(canvas).toContain("usePrefersReducedMotion()");
    expect(canvas).toContain("activeNodeFocusDuration(prefersReducedMotion)");
    expect(canvas).toContain("duration: focusDuration");
  });

  it("gives inspector type badges and evidence-group headers the same icon language as the canvas", () => {
    expect(canvas).toContain("function TypeBadge({ type }: { type: VisualNodeType })");
    expect(canvas).toContain("<TypeBadge type={node.type} />");
    // EvidenceGroup renders a type-colored icon chip above each grouping (Agents, Models, Tools, ...).
    expect(canvas).toContain("function EvidenceGroup({ type, items }: { type: VisualNodeType; items: VisualNode[] }) {");
    expect(canvas.match(/<Icon className={`h-2\.5 w-2\.5 \$\{def\.accentClass\}`} aria-hidden="true" \/>/)).toBeTruthy();
  });
});

describe("repository hygiene", () => {
  it("does not retain accidental TypeScript copy files", () => {
    expect(walk(root)).toEqual([]);
  });

  it("removes the previously flagged runGraph duplicates", () => {
    expect(existsSync(path.join(root, "lib/runs/runGraph 2.ts"))).toBe(false);
    expect(existsSync(path.join(root, "lib/runs/__tests__/runGraph.test 2.ts"))).toBe(false);
  });

  it("seed and simulation scripts use the current run store abstraction", () => {
    for (const script of [
      "scripts/seed-trace-run.ts",
      "scripts/seed-campaign-sandbox-run.ts",
      "scripts/simulate-live-run.ts",
    ]) {
      const source = read(script);
      expect(source).toContain("getRunStore");
      expect(source).not.toContain("fileRunStore");
    }
  });
});
