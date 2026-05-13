import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { runScanPipeline } from "@/lib/reports/runScanPipeline";
import { MAX_SCANNED_ZIP_FILES, MAX_ZIP_ENTRIES } from "../limits";
import { safeExtractZip, ZipExtractionError } from "../safeExtractZip";

async function zipBuffer(entries: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

describe("safeExtractZip", () => {
  it("creates RepoFile-compatible entries from a valid ZIP", async () => {
    const result = await safeExtractZip(await zipBuffer({
      "README.md": "# Hello",
      "src/index.ts": "export const value = 1;",
    }));

    expect(result.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
    expect(result.files[0].content).toBe("# Hello");
  });

  it("strips a top-level GitHub folder", async () => {
    const result = await safeExtractZip(await zipBuffer({
      "repo-main/README.md": "# Hello",
      "repo-main/src/index.ts": "export const value = 1;",
    }));

    expect(result.strippedRoot).toBe("repo-main");
    expect(result.files.map((file) => file.path)).toEqual(["README.md", "src/index.ts"]);
  });

  it("ignores path traversal entries", async () => {
    const result = await safeExtractZip(await zipBuffer({
      "../escape.ts": "export const bad = true;",
      "src/index.ts": "export const ok = true;",
      "README.md": "# ok",
    }));

    expect(result.files.map((file) => file.path)).toContain("src/index.ts");
    expect(result.ignoredFiles.some((file) => file.reason === "Unsafe ZIP entry path is ignored.")).toBe(true);
  });

  it("ignores absolute paths", async () => {
    const result = await safeExtractZip(await zipBuffer({
      "/tmp/escape.ts": "export const bad = true;",
      "src/index.ts": "export const ok = true;",
      "README.md": "# ok",
    }));

    expect(result.files.map((file) => file.path)).toContain("src/index.ts");
    expect(result.ignoredFiles.some((file) => file.reason === "Unsafe ZIP entry path is ignored.")).toBe(true);
  });

  it("ignores .env files except .env.example", async () => {
    const result = await safeExtractZip(await zipBuffer({
      ".env": "OPENAI_API_KEY=sk-not-read",
      ".env.example": "OPENAI_API_KEY=",
    }));

    const env = result.files.find((file) => file.path === ".env");
    const example = result.files.find((file) => file.path === ".env.example");
    expect(env?.content).toBeUndefined();
    expect(example?.content).toBe("OPENAI_API_KEY=");
  });

  it("ignores binary files", async () => {
    const result = await safeExtractZip(await zipBuffer({
      "src/index.ts": "export const value = 1;",
      "data/blob.dat": new Uint8Array([0, 1, 2, 3]),
    }));

    const binary = result.files.find((file) => file.path === "data/blob.dat");
    expect(binary?.content).toBeUndefined();
    expect(result.ignoredFiles.some((file) => file.path === "data/blob.dat")).toBe(true);
  });

  it("allows a 537-file ZIP under the byte limits", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: 537 }, (_, index) => [`src/file-${index}.ts`, `export const value${index} = ${index};`]),
    );

    const result = await safeExtractZip(await zipBuffer(entries));

    expect(result.files).toHaveLength(537);
    expect(result.zipStats.candidateFiles).toBe(537);
    expect(result.zipStats.scannedFiles).toBe(537);
    expect(result.zipStats.skippedByFileLimit).toBe(0);
  });

  it("enforces max entries", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => [`src/file-${index}.ts`, "export {};"]),
    );

    await expect(safeExtractZip(await zipBuffer(entries))).rejects.toThrow(
      "ZIP contains too many entries to inspect safely. Maximum entries: 2,000. Use GitHub repository scanning or reduce the archive.",
    );
  });

  it("scans a prioritized subset when candidates exceed max scanned files", async () => {
    const entries = Object.fromEntries(
      Array.from({ length: MAX_SCANNED_ZIP_FILES + 5 }, (_, index) => [`src/file-${index}.ts`, "export {};"]),
    );

    const result = await safeExtractZip(await zipBuffer(entries));

    expect(result.files).toHaveLength(MAX_SCANNED_ZIP_FILES);
    expect(result.zipStats.candidateFiles).toBe(MAX_SCANNED_ZIP_FILES + 5);
    expect(result.zipStats.scannedFiles).toBe(MAX_SCANNED_ZIP_FILES);
    expect(result.zipStats.skippedByFileLimit).toBe(5);
    expect(result.ignoredFiles.filter((file) => file.reason.includes("Lower-priority text file skipped"))).toHaveLength(5);
  });

  it("prioritizes agent and workflow manifests before slicing", async () => {
    const lowPriorityEntries = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`misc/file-${index}.txt`, `notes ${index}`]),
    );

    const result = await safeExtractZip(await zipBuffer({
      ...lowPriorityEntries,
      "misc/late.txt": "notes",
      "AGENTS.md": "Agent operating guide.",
      "workflow.yaml": "workflow:\n  id: main\n",
    }), {
      limits: { maxScannedFiles: 2 },
    });

    expect(result.files.map((file) => file.path)).toEqual(["AGENTS.md", "workflow.yaml"]);
    expect(result.zipStats.candidateFiles).toBe(23);
    expect(result.zipStats.scannedFiles).toBe(2);
    expect(result.zipStats.skippedByFileLimit).toBe(21);
  });

  it("adds a warning finding when ZIP candidates are truncated", async () => {
    const extracted = await safeExtractZip(await zipBuffer({
      "AGENTS.md": "Agent operating guide.",
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "export const b = 2;",
    }), {
      limits: { maxScannedFiles: 2 },
    });

    const report = await runScanPipeline({
      repoName: "truncated.zip",
      files: extracted.files,
      scanSource: { type: "zip", label: "truncated.zip", filename: "truncated.zip" },
      zipStats: extracted.zipStats,
    });

    const warning = report.findings.find((finding) => finding.id === "zip-scan-prioritized-subset");
    expect(warning?.title).toBe("ZIP scan analyzed prioritized subset");
    expect(warning?.summary).toBe(
      "ZIP contained 3 candidate files. AgentPulse scanned the top 2 prioritized files and skipped 1 lower-priority files.",
    );
  });

  it("supports smaller scanned-file limits for tests", async () => {
    await expect(safeExtractZip(await zipBuffer({
      "a.ts": "a",
      "b.ts": "b",
    }), {
      limits: { maxScannedFiles: 1 },
    })).resolves.toMatchObject({
      zipStats: {
        candidateFiles: 2,
        scannedFiles: 1,
        skippedByFileLimit: 1,
      },
    });
  });

  it("enforces max uncompressed size", async () => {
    await expect(safeExtractZip(await zipBuffer({
      "a.ts": "12345",
      "b.ts": "67890",
    }), {
      limits: { maxUncompressedBytes: 8 },
    })).rejects.toBeInstanceOf(ZipExtractionError);
  });

  it("ZIP scan detects workflow.yaml", async () => {
    const extracted = await safeExtractZip(await zipBuffer({
      "repo-main/workflow.yaml": `workflow:
  id: zip_workflow
  name: ZIP Workflow
  type: deterministic_workflow
`,
    }));
    const report = await runScanPipeline({
      repoName: "repo-main.zip",
      files: extracted.files,
      scanSource: { type: "zip", label: "repo-main.zip", filename: "repo-main.zip" },
    });

    expect(report.scanSource?.type).toBe("zip");
    expect(report.detectedWorkflowsDetailed[0].id).toBe("zip_workflow");
  });

  it("ZIP scan detects and redacts a high-confidence fake secret", async () => {
    const extracted = await safeExtractZip(await zipBuffer({
      "src/config.ts": 'export const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456";',
    }));
    const report = await runScanPipeline({
      repoName: "secret.zip",
      files: extracted.files,
      scanSource: { type: "zip", label: "secret.zip", filename: "secret.zip" },
    });
    const secretFinding = report.findings.find((finding) => finding.id.startsWith("redacted-secret-"));

    expect(secretFinding?.severity).toBe("high");
    expect(secretFinding?.evidenceSnippets?.[0].excerpt).toContain("[REDACTED:GitHub token]");
    expect(secretFinding?.recommendation).toBe("If this ZIP came from a real repo, remove and rotate confirmed secrets.");
  });
});
