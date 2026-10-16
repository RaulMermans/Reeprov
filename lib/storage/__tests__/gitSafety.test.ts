import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAgentPulseHome, getPrivacyPosture, getStorageSubdirectories } from "../dataPath";

describe("Data Location & Privacy Posture", () => {
  it("resolves storage data path with layout subdirectories", () => {
    const home = getAgentPulseHome();
    expect(home).toBeTruthy();

    const subs = getStorageSubdirectories(home);
    expect(subs.runs).toContain("runs");
    expect(subs.comparisons).toContain("comparisons");
    expect(subs.blobs).toContain("blobs");
    expect(subs.evals).toContain("evals");
    expect(subs.baselines).toContain("baselines");
    expect(subs.backups).toContain("backups");
  });

  it("returns privacy posture with zero telemetry and local loopback status", () => {
    const posture = getPrivacyPosture();
    expect(posture.telemetryStatus).toBe("DISABLED");
    expect(posture.cloudSync).toBe("DISABLED");
    expect(posture.dataPath).toBeTruthy();
  });
});

describe("Git Safety Guard (.gitignore audit)", () => {
  it("ensures .gitignore strictly ignores private runtime paths and traces", () => {
    const gitignorePath = path.resolve(process.cwd(), ".gitignore");
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, "utf-8");

    // Critical private data paths
    expect(content).toMatch(/\.reeprov/);
    expect(content).toMatch(/\*\.reeprov-export\*/);
    expect(content).toMatch(/\.agentpulse/);
    expect(content).toMatch(/\*\.agentpulse-export\*/);
    expect(content).toMatch(/\*\.db/);
    expect(content).toMatch(/\*\.sqlite/);
    expect(content).toMatch(/agentpulse\.db/);
    expect(content).toMatch(/reeprov\.db/);
    expect(content).toMatch(/\/runs/);
    expect(content).toMatch(/\/comparisons/);
    expect(content).toMatch(/\/blobs/);
  });
});
