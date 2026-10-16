/**
 * Reeprov Safe Brand Migration Tool.
 *
 * Migrates local AgentPulse data from ~/.agentpulse to ~/.reeprov:
 *   1. Source detection
 *   2. Destination detection
 *   3. Preflight & collision checks
 *   4. Safe backup creation
 *   5. Migration through temporary destination
 *   6. Validation
 *   7. Atomic activation
 *   8. Rollback instructions
 *   9. No overwrite if destination already contains data
 *   10. Never copies credentials or data into Git/repository
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MigrationOptions {
  source?: string;
  dest?: string;
  dryRun?: boolean;
}

export interface MigrationResult {
  success: boolean;
  source: string;
  dest: string;
  backupPath?: string;
  migratedFilesCount?: number;
  message: string;
  rollbackInstructions?: string;
}

function hasMeaningfulData(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) return false;
  try {
    const entries = fs.readdirSync(dirPath).filter((f) => f !== ".DS_Store" && f !== ".gitkeep");
    return entries.length > 0;
  } catch {
    return false;
  }
}

function copyRecursive(src: string, dest: string): number {
  let count = 0;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

export async function runBrandMigration(options: MigrationOptions = {}): Promise<MigrationResult> {
  const source = path.resolve(
    options.source ||
      process.env.AGENTPULSE_HOME ||
      path.join(os.homedir(), ".agentpulse")
  );
  const dest = path.resolve(
    options.dest ||
      process.env.REEPROV_HOME ||
      path.join(os.homedir(), ".reeprov")
  );

  // 1. Source detection
  if (!fs.existsSync(source) || !hasMeaningfulData(source)) {
    return {
      success: true,
      source,
      dest,
      migratedFilesCount: 0,
      message: `No existing AgentPulse data found at '${source}'. Nothing to migrate.`,
    };
  }

  // 2. Destination detection & collision check
  if (fs.existsSync(dest) && hasMeaningfulData(dest)) {
    return {
      success: false,
      source,
      dest,
      message:
        `Migration collision detected: Both source ('${source}') and destination ('${dest}') contain data.\n` +
        "Automatic merge is not permitted to preserve data integrity.\n\n" +
        "Actionable Next Steps:\n" +
        `  1. Inspect destination: ls -la "${dest}"\n` +
        `  2. If destination is disposable or already migrated, remove or archive it: mv "${dest}" "${dest}_archive"\n` +
        `  3. If destination should be retained, point REEPROV_HOME to it or consolidate manually.\n` +
        `  4. Re-run: npm run reeprov -- migrate-brand`,
    };
  }

  if (options.dryRun) {
    return {
      success: true,
      source,
      dest,
      message: `[Dry Run] Would safely migrate '${source}' to '${dest}'.`,
    };
  }

  // 3. Backup creation
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(
    path.dirname(source),
    `.agentpulse-backup-${timestamp}`
  );

  try {
    copyRecursive(source, backupPath);
  } catch (err: any) {
    return {
      success: false,
      source,
      dest,
      message: `Failed to create pre-migration backup at '${backupPath}': ${err.message}`,
    };
  }

  // 4. Staging via temporary destination
  const tmpDest = path.resolve(
    path.dirname(dest),
    `.reeprov-staging-${timestamp}`
  );

  let fileCount = 0;
  try {
    fileCount = copyRecursive(source, tmpDest);
  } catch (err: any) {
    if (fs.existsSync(tmpDest)) {
      fs.rmSync(tmpDest, { recursive: true, force: true });
    }
    return {
      success: false,
      source,
      dest,
      backupPath,
      message: `Failed during migration staging: ${err.message}`,
      rollbackInstructions: `Restore source from backup '${backupPath}' if modified.`,
    };
  }

  // 5. Validation
  const stagedEntries = fs.readdirSync(tmpDest);
  if (stagedEntries.length === 0 && fileCount > 0) {
    fs.rmSync(tmpDest, { recursive: true, force: true });
    return {
      success: false,
      source,
      dest,
      backupPath,
      message: "Staged destination validation failed (empty directory).",
      rollbackInstructions: `Source remains untouched at '${source}'. Backup at '${backupPath}'.`,
    };
  }

  // 6. Atomic activation
  try {
    if (fs.existsSync(dest)) {
      fs.rmdirSync(dest); // safe only if empty (already checked)
    }
    fs.renameSync(tmpDest, dest);
  } catch (err: any) {
    // Cross-device fallback
    try {
      copyRecursive(tmpDest, dest);
      fs.rmSync(tmpDest, { recursive: true, force: true });
    } catch (innerErr: any) {
      return {
        success: false,
        source,
        dest,
        backupPath,
        message: `Failed to activate destination '${dest}': ${innerErr.message}`,
        rollbackInstructions: `Restore from backup '${backupPath}' or staged directory '${tmpDest}'.`,
      };
    }
  }

  const rollbackInstructions =
    `Rollback Instructions:\n` +
    `  If you need to revert to AgentPulse layout:\n` +
    `  1. Ensure your backup is intact: ls -la "${backupPath}"\n` +
    `  2. Revert canonical directory: mv "${dest}" "${dest}_reverted"\n` +
    `  3. Or restore source: cp -r "${backupPath}" "${source}"\n` +
    `  4. Set REEPROV_HOME="${source}" in your environment.`;

  return {
    success: true,
    source,
    dest,
    backupPath,
    migratedFilesCount: fileCount,
    message:
      `Successfully migrated Reeprov data from '${source}' to '${dest}' (${fileCount} files migrated).\n` +
      `Safety backup preserved at: '${backupPath}'.`,
    rollbackInstructions,
  };
}
