export interface ZipExtractLimits {
  maxZipBytes: number;
  maxUncompressedBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxPathLength: number;
}

export interface ZipIgnoredFile {
  path: string;
  reason: string;
  size: number;
}

export interface ExtractedZipFile {
  path: string;
  size: number;
  content?: string;
}

export interface SafeExtractZipResult {
  files: ExtractedZipFile[];
  ignoredFiles: ZipIgnoredFile[];
  strippedRoot?: string;
}

export const defaultZipExtractLimits: ZipExtractLimits = {
  maxZipBytes: 15 * 1024 * 1024,
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxFiles: 500,
  maxFileBytes: 1024 * 1024,
  maxPathLength: 240,
};
