import {
  DIRECT_ZIP_UPLOAD_MAX_BYTES,
  MAX_UNCOMPRESSED_ZIP_BYTES,
  MAX_ZIP_FILES,
  MAX_ZIP_PATH_LENGTH,
  MAX_ZIP_TEXT_FILE_BYTES,
} from "./limits";

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
  maxZipBytes: DIRECT_ZIP_UPLOAD_MAX_BYTES,
  maxUncompressedBytes: MAX_UNCOMPRESSED_ZIP_BYTES,
  maxFiles: MAX_ZIP_FILES,
  maxFileBytes: MAX_ZIP_TEXT_FILE_BYTES,
  maxPathLength: MAX_ZIP_PATH_LENGTH,
};
