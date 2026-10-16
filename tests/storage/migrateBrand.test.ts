import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { runBrandMigration } from "../../scripts/migrate-brand";

describe("Reeprov Safe Brand Migration (~/.agentpulse -> ~/.reeprov)", () => {
  let tmpRoot: string;
  let fakeSource: string;
  let fakeDest: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reeprov-test-migrate-"));
    fakeSource = path.join(tmpRoot, ".agentpulse");
    fakeDest = path.join(tmpRoot, ".reeprov");
  });

  afterEach(() => {
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("handles missing source gracefully with nothing_to_migrate status", async () => {
    const res = await runBrandMigration({ source: fakeSource, dest: fakeDest });
    expect(res.success).toBe(true);
    expect(res.message).toContain("Nothing to migrate");
  });

  it("safely migrates data and creates backup when source exists and destination is absent", async () => {
    fs.mkdirSync(path.join(fakeSource, "runs"), { recursive: true });
    fs.writeFileSync(path.join(fakeSource, "config.json"), JSON.stringify({ version: "0.1.0" }));
    fs.writeFileSync(path.join(fakeSource, "runs", "run-1.json"), JSON.stringify({ id: "run-1" }));

    const res = await runBrandMigration({ source: fakeSource, dest: fakeDest });
    expect(res.success).toBe(true);
    expect(res.migratedFilesCount).toBe(2);
    expect(fs.existsSync(path.join(fakeDest, "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(fakeDest, "runs", "run-1.json"))).toBe(true);
    expect(res.backupPath).toBeDefined();
    expect(fs.existsSync(res.backupPath!)).toBe(true);
    expect(res.rollbackInstructions).toContain("Rollback Instructions");
  });

  it("refuses to overwrite when destination already contains meaningful data (collision gate)", async () => {
    fs.mkdirSync(path.join(fakeSource, "runs"), { recursive: true });
    fs.writeFileSync(path.join(fakeSource, "source.txt"), "legacy data");

    fs.mkdirSync(path.join(fakeDest, "runs"), { recursive: true });
    fs.writeFileSync(path.join(fakeDest, "dest.txt"), "new data");

    const res = await runBrandMigration({ source: fakeSource, dest: fakeDest });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Migration collision detected");
    // Verify source and dest remain intact
    expect(fs.readFileSync(path.join(fakeDest, "dest.txt"), "utf8")).toBe("new data");
    expect(fs.readFileSync(path.join(fakeSource, "source.txt"), "utf8")).toBe("legacy data");
  });

  it("supports dry-run without modifying filesystem", async () => {
    fs.mkdirSync(path.join(fakeSource, "runs"), { recursive: true });
    fs.writeFileSync(path.join(fakeSource, "source.txt"), "legacy data");

    const res = await runBrandMigration({ source: fakeSource, dest: fakeDest, dryRun: true });
    expect(res.success).toBe(true);
    expect(res.message).toContain("[Dry Run]");
    expect(fs.existsSync(fakeDest)).toBe(false);
  });
});
