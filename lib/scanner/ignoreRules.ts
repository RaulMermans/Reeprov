const ignoredSegments = [
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
];

const ignoredExact = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
]);

const ignoredExtensions = new Set([
  ".7z",
  ".avif",
  ".bin",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".exe",
  ".gif",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp4",
  ".pdf",
  ".png",
  ".so",
  ".webp",
  ".zip",
]);

const maxTextFileSize = 120_000;

export function getFileName(path: string) {
  return path.split("/").pop() ?? path;
}

export function getExtension(path: string) {
  const name = getFileName(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

export function shouldIgnorePath(path: string, size = 0) {
  const normalized = path.replaceAll("\\", "/");
  const lower = normalized.toLowerCase();
  const name = getFileName(lower);
  const segments = lower.split("/");
  const extension = getExtension(lower);

  if (ignoredExact.has(name)) {
    return { ignored: true, reason: "Sensitive environment file is never scanned." };
  }

  if (name.endsWith(".pem") || name.endsWith(".key")) {
    return { ignored: true, reason: "Private key material is never scanned." };
  }

  if (segments.some((segment) => ignoredSegments.includes(segment))) {
    return { ignored: true, reason: "Generated, dependency, or VCS path is ignored." };
  }

  if (ignoredExtensions.has(extension)) {
    return { ignored: true, reason: "Binary or unsupported file type is ignored." };
  }

  if (size > maxTextFileSize) {
    return { ignored: true, reason: "Large file is ignored by the scanner size limit." };
  }

  return { ignored: false, reason: undefined };
}
