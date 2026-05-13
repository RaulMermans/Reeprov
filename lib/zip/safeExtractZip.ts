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
  const plans = buildEntryPlans(zip, limits);
  const stripped = stripCommonGithubRoot(plans.map((plan) => plan.safePath));
  const files: ExtractedZipFile[] = [];
  const ignoredFiles: ZipIgnoredFile[] = [];
  let totalUncompressed = 0;

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
      throw new ZipExtractionError(`ZIP entry path is too long: ${plan.safePath}`);
    }

    const ignore = shouldIgnorePath(normalizedPath, plan.size);
    if (ignore.ignored) {
      files.push({ path: normalizedPath, size: plan.size });
      ignoredFiles.push({
        path: normalizedPath,
        reason: ignore.reason ?? "Ignored by scanner rules.",
        size: plan.size,
      });
      continue;
    }

    if (plan.size > limits.maxFileBytes) {
      files.push({ path: normalizedPath, size: plan.size });
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
      files.push({ path: normalizedPath, size: bytes.byteLength });
      ignoredFiles.push({
        path: normalizedPath,
        reason: "Binary file is ignored.",
        size: bytes.byteLength,
      });
      continue;
    }

    files.push({
      path: normalizedPath,
      size: bytes.byteLength,
      content: new TextDecoder("utf-8").decode(bytes),
    });
  }

  return {
    files,
    ignoredFiles,
    strippedRoot: stripped.root,
  };
}

function buildEntryPlans(zip: JSZip, limits: ZipExtractLimits): EntryPlan[] {
  const plans: EntryPlan[] = [];

  zip.forEach((zipPath, entry) => {
    if (entry.dir) return;

    const unsafeOriginalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName;
    const safePath = normalizeZipPath(unsafeOriginalName ?? zipPath);
    if (safePath.length > limits.maxPathLength) {
      throw new ZipExtractionError(`ZIP entry path is too long: ${safePath}`);
    }

    if (isSymlink(entry)) {
      return;
    }

    plans.push({
      safePath,
      size: uncompressedSize(entry),
      entry,
    });
  });

  if (plans.length > limits.maxFiles) {
    throw new ZipExtractionError(`ZIP contains too many files. Maximum file count is ${limits.maxFiles}.`);
  }

  return plans;
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
    throw new ZipExtractionError(`Unsafe ZIP entry path rejected: ${rawPath}`);
  }

  const normalized = path.posix.normalize(withoutLeadingDot);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new ZipExtractionError(`Unsafe ZIP entry path rejected: ${rawPath}`);
  }

  return normalized;
}

function stripCommonGithubRoot(paths: string[]) {
  if (paths.length === 0) return { root: undefined };

  const firstSegments = paths.map((filePath) => filePath.split("/"));
  if (firstSegments.some((segments) => segments.length < 2)) {
    return { root: undefined };
  }

  const root = firstSegments[0][0];
  if (root && firstSegments.every((segments) => segments[0] === root)) {
    return { root };
  }

  return { root: undefined };
}

function stripRoot(filePath: string, root: string) {
  return filePath === root ? "" : filePath.slice(root.length + 1);
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
