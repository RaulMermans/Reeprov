import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Git Safety & Privacy Protection (Sprint Item 31)", () => {
  const rootDir = process.cwd();
  const gitignorePath = path.resolve(rootDir, ".gitignore");

  it("1. reads .gitignore and verifies required private runtime entries", () => {
    expect(fs.existsSync(gitignorePath), ".gitignore file must exist").toBe(true);

    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
    const lines = gitignoreContent
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    // 1. .agentpulse/
    expect(
      lines.some((l) => l === ".agentpulse/" || l === ".agentpulse"),
      ".gitignore must ignore .agentpulse/ or .agentpulse"
    ).toBe(true);

    // 2. *.db
    expect(
      lines.some((l) => l === "*.db" || l.includes("*.db")),
      ".gitignore must ignore *.db"
    ).toBe(true);

    // 3. .env
    expect(
      lines.some((l) => l === ".env"),
      ".gitignore must ignore .env"
    ).toBe(true);

    // 4. .env.local
    expect(
      lines.some((l) => l === ".env.local"),
      ".gitignore must ignore .env.local"
    ).toBe(true);

    // 5. credentials.json
    expect(
      lines.some((l) => l === "credentials.json"),
      ".gitignore must ignore credentials.json"
    ).toBe(true);
  });

  it("2. verifies .gitignore contains SQLite and export archive ignore rules", () => {
    const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

    expect(gitignoreContent).toMatch(/\.agentpulse/);
    expect(gitignoreContent).toMatch(/\*\.agentpulse-export/);
    expect(gitignoreContent).toMatch(/\*\.sqlite/);
    expect(gitignoreContent).toMatch(/agentpulse\.db/);
    expect(gitignoreContent).toMatch(/\/runs/);
    expect(gitignoreContent).toMatch(/\/comparisons/);
    expect(gitignoreContent).toMatch(/\/blobs/);
  });

  it("3. verifies no runtime data paths or credentials are tracked in git repository", () => {
    // Query tracked files via git ls-files
    const stdout = execSync("git ls-files", {
      cwd: rootDir,
      encoding: "utf8",
    });

    const trackedFiles = stdout.split("\n").map((f) => f.trim()).filter(Boolean);

    // No .agentpulse runtime files
    const trackedAgentPulse = trackedFiles.filter((f) =>
      f.startsWith(".agentpulse/") || f.includes("/.agentpulse/") || f === ".agentpulse"
    );
    expect(
      trackedAgentPulse,
      `Tracked .agentpulse files found in repository:\n${trackedAgentPulse.join("\n")}`
    ).toEqual([]);

    // No database files
    const trackedDbFiles = trackedFiles.filter((f) =>
      f.endsWith(".db") || f.endsWith(".sqlite") || f.endsWith(".sqlite3") || f.includes("agentpulse.db")
    );
    expect(
      trackedDbFiles,
      `Tracked database files found in repository:\n${trackedDbFiles.join("\n")}`
    ).toEqual([]);

    // No credentials files
    const trackedCredentials = trackedFiles.filter((f) =>
      f.endsWith("credentials.json") || f.endsWith(".credentials")
    );
    expect(
      trackedCredentials,
      `Tracked credentials files found in repository:\n${trackedCredentials.join("\n")}`
    ).toEqual([]);

    // No local environment files
    const trackedEnvFiles = trackedFiles.filter((f) =>
      f === ".env" || f === ".env.local" || f.endsWith("/.env.local")
    );
    expect(
      trackedEnvFiles,
      `Tracked .env/.env.local files found in repository:\n${trackedEnvFiles.join("\n")}`
    ).toEqual([]);
  });
});
