import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { runScanPipeline } from "@/lib/reports/runScanPipeline";
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

  it("rejects path traversal entries", async () => {
    await expect(safeExtractZip(await zipBuffer({
      "../escape.ts": "export const bad = true;",
    }))).rejects.toBeInstanceOf(ZipExtractionError);
  });

  it("rejects absolute paths", async () => {
    await expect(safeExtractZip(await zipBuffer({
      "/tmp/escape.ts": "export const bad = true;",
    }))).rejects.toBeInstanceOf(ZipExtractionError);
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

  it("enforces maxFiles", async () => {
    await expect(safeExtractZip(await zipBuffer({
      "a.ts": "a",
      "b.ts": "b",
    }), {
      limits: { maxFiles: 1 },
    })).rejects.toBeInstanceOf(ZipExtractionError);
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
