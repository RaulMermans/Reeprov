import path from "node:path";
import JSZip from "jszip";
import { shouldIgnorePath } from "@/lib/scanner/ignoreRules";
import {
  defaultZipExtractLimits,
  type ExtractedZipFile,
  type SafeExtractZipResult,
  type ZipExtractLimits,
  type ZipIgnoredFile,
} from "./types";

interface SafeExtractZipOptions {
  limits?: Partial<ZipExtractLimits>;
}

interface EntryPlan {
  safePath: string;
  size: number;
  entry: JSZip.JSZipObject;
  index: number;
}

interface CandidateFile {
  path: string;
  size: number;
  content: string;
  priority: number;
  index: number;
}

interface EntryPlanResult {
  plans: EntryPlan[];
  ignoredFiles: ZipIgnoredFile[];
  totalFiles: number;
}

export class ZipExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipExtractionError";
  }
}

export async function safeExtractZip(
  input: ArrayBuffer | Uint8Array | Buffer,
  options: SafeExtractZipOptions = {},
): Promise<SafeExtractZipResult> {
  const limits = { ...defaultZipExtractLimits, ...options.limits };
  const zipBytes = input.byteLength;

  if (zipBytes > limits.maxZipBytes) {
    throw new ZipExtractionError(`ZIP is too large. Maximum size is ${formatBytes(limits.maxZipBytes)}.`);
  }

  const zip = await JSZip.loadAsync(input);
  const totalEntries = Object.keys(zip.files).length;
  if (totalEntries > limits.maxEntries) {
    throw new ZipExtractionError(
      `ZIP contains too many entries to inspect safely. Maximum entries: ${formatCount(limits.maxEntries)}. Use GitHub repository scanning or reduce the archive.`,
    );
  }

  const entryPlanResult = buildEntryPlans(zip);
  const plans = entryPlanResult.plans;
  const stripped = stripCommonGithubRoot(plans.map((plan) => plan.safePath));
  const candidateFiles: CandidateFile[] = [];
  const ignoredFiles: ZipIgnoredFile[] = [...entryPlanResult.ignoredFiles];
  let totalUncompressed = ignoredFiles.reduce((total, file) => total + file.size, 0);
  if (totalUncompressed > limits.maxUncompressedBytes) {
    throw new ZipExtractionError(
      `ZIP uncompressed content is too large. Maximum size is ${formatBytes(limits.maxUncompressedBytes)}.`,
    );
  }

  for (const plan of plans) {
    totalUncompressed += plan.size;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw new ZipExtractionError(
        `ZIP uncompressed content is too large. Maximum size is ${formatBytes(limits.maxUncompressedBytes)}.`,
      );
    }

    const normalizedPath = stripped.root
      ? stripRoot(plan.safePath, stripped.root)
      : plan.safePath;

    if (!normalizedPath || normalizedPath.length > limits.maxPathLength) {
      ignoredFiles.push({
        path: normalizedPath || plan.safePath,
        reason: `ZIP entry path exceeds ${limits.maxPathLength} characters.`,
        size: plan.size,
      });
      continue;
    }

    const ignore = shouldIgnorePath(normalizedPath, plan.size);
    if (ignore.ignored) {
      ignoredFiles.push({
        path: normalizedPath,
        reason: ignore.reason ?? "Ignored by scanner rules.",
        size: plan.size,
      });
      continue;
    }

    if (plan.size > limits.maxFileBytes) {
      ignoredFiles.push({
        path: normalizedPath,
        reason: `File exceeds ZIP text file limit of ${formatBytes(limits.maxFileBytes)}.`,
        size: plan.size,
      });
      continue;
    }

    const bytes = await plan.entry.async("uint8array");
    if (bytes.byteLength !== plan.size) {
      totalUncompressed += Math.max(0, bytes.byteLength - plan.size);
      if (totalUncompressed > limits.maxUncompressedBytes) {
        throw new ZipExtractionError(
          `ZIP uncompressed content is too large. Maximum size is ${formatBytes(limits.maxUncompressedBytes)}.`,
        );
      }
    }

    if (isBinary(bytes)) {
      ignoredFiles.push({
        path: normalizedPath,
        reason: "Binary file is ignored.",
        size: bytes.byteLength,
      });
      continue;
    }

    candidateFiles.push({
      path: normalizedPath,
      size: bytes.byteLength,
      content: new TextDecoder("utf-8").decode(bytes),
      priority: zipFilePriority(normalizedPath),
      index: plan.index,
    });
  }

  const prioritizedCandidates = candidateFiles.sort((left, right) =>
    left.priority - right.priority || left.index - right.index || left.path.localeCompare(right.path),
  );
  const selectedCandidates = prioritizedCandidates.slice(0, limits.maxScannedFiles);
  const skippedCandidates = prioritizedCandidates.slice(limits.maxScannedFiles);

  for (const skipped of skippedCandidates) {
    ignoredFiles.push({
      path: skipped.path,
      reason: `Lower-priority text file skipped because ZIP scans analyze at most ${limits.maxScannedFiles} prioritized files.`,
      size: skipped.size,
    });
  }

  const strippedRootFolder = stripped.root;

  return {
    files: selectedCandidates.map(({ path, size, content }) => ({ path, size, content })),
    ignoredFiles,
    strippedRoot: strippedRootFolder,
    zipStats: {
      totalEntries,
      totalFiles: entryPlanResult.totalFiles,
      candidateFiles: candidateFiles.length,
      scannedFiles: selectedCandidates.length,
      skippedByFileLimit: skippedCandidates.length,
      strippedRootFolder,
    },
  };
}

function buildEntryPlans(zip: JSZip): EntryPlanResult {
  const plans: EntryPlan[] = [];
  const ignoredFiles: ZipIgnoredFile[] = [];
  let index = 0;
  let totalFiles = 0;

  zip.forEach((zipPath, entry) => {
    if (entry.dir) return;
    totalFiles += 1;

    const unsafeOriginalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    const rawPath = unsafeOriginalName ?? zipPath;
    const safePath = normalizeZipPath(rawPath);
    const size = uncompressedSize(entry);
    if (!safePath) {
      ignoredFiles.push({
        path: safeDisplayPath(rawPath),
        reason: "Unsafe ZIP entry path is ignored.",
        size,
      });
      return;
    }

    if (isSymlink(entry)) {
      ignoredFiles.push({
        path: safePath,
        reason: "Symlink ZIP entry is ignored.",
        size,
      });
      return;
    }

    plans.push({
      safePath,
      size,
      entry,
      index,
    });

    index += 1;
  });

  return { plans, ignoredFiles, totalFiles };
}

function normalizeZipPath(rawPath: string) {
  const normalizedSlashes = rawPath.replaceAll("\\", "/");
  const withoutLeadingDot = normalizedSlashes.replace(/^\.\//, "");

  if (
    withoutLeadingDot.includes("\0") ||
    withoutLeadingDot.startsWith("/") ||
    /^[A-Za-z]:\//.test(withoutLeadingDot) ||
    withoutLeadingDot.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  const normalized = path.posix.normalize(withoutLeadingDot);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return undefined;
  }

  return normalized;
}

function safeDisplayPath(rawPath: string) {
  return rawPath.replaceAll("\0", "").slice(0, 240) || "[unsafe path]";
}

function stripCommonGithubRoot(paths: string[]) {
  if (paths.length === 0) return { root: undefined };

  const firstSegments = paths.map((filePath) => filePath.split("/"));
  if (firstSegments.some((segments) => segments.length < 2)) {
    return { root: undefined };
  }

  const root = firstSegments[0][0];
  if (root && root.includes("-") && firstSegments.every((segments) => segments[0] === root)) {
    return { root };
  }

  return { root: undefined };
}

function stripRoot(filePath: string, root: string) {
  return filePath === root ? "" : filePath.slice(root.length + 1);
}

function zipFilePriority(filePath: string) {
  const lower = filePath.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  const normalized = `/${lower}`;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

  if (name === "agents.md") return 1;
  if (name === "claude.md") return 2;
  if (/^agents\.(ya?ml|json)$/.test(name)) return 3;
  if (/^workflows?\.(ya?ml|json)$/.test(name)) return 4;
  if (normalized.includes("/agents/")) return 5;
  if (normalized.includes("/prompts/")) return 6;
  if (normalized.includes("/tools/")) return 7;
  if (normalized.includes("/evals/") || normalized.includes("/evaluations/")) return 8;
  if (normalized.includes("/.github/workflows/")) return 9;
  if (normalized.includes("/workflows/")) return 9;
  if (name === "readme.md") return 10;
  if (normalized.includes("/docs/")) return 11;
  if (isPackageConfig(name)) return 12;
  if (isSourceFile(extension)) return 13;
  if (isTestPath(normalized, name)) return 14;

  return 15;
}

function isPackageConfig(name: string) {
  return [
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "requirements.txt",
    "pyproject.toml",
    "uv.lock",
  ].includes(name);
}

function isSourceFile(extension: string) {
  return [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php"].includes(extension);
}

function isTestPath(normalizedPath: string, name: string) {
  return (
    normalizedPath.includes("/tests/") ||
    normalizedPath.includes("/test/") ||
    /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(name)
  );
}

function uncompressedSize(entry: JSZip.JSZipObject) {
  const internal = entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  };
  return internal._data?.uncompressedSize ?? 0;
}

function isSymlink(entry: JSZip.JSZipObject) {
  const permissions = entry.unixPermissions;
  const mode =
    typeof permissions === "number"
      ? permissions
      : typeof permissions === "string"
        ? Number.parseInt(permissions, 8)
        : 0;

  return (mode & 0o170000) === 0o120000;
}

function isBinary(bytes: Uint8Array) {
  if (bytes.byteLength === 0) return false;

  const sample = bytes.slice(0, Math.min(bytes.byteLength, 8192));
  if (sample.includes(0)) return true;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return false;
  } catch {
    return true;
  }
}

function formatBytes(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
