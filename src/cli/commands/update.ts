import { Command } from "commander";
import { createRequire } from "module";
import { execSync } from "child_process";
import * as path from "node:path";
import * as os from "node:os";
import { fileExists } from "../../lib/fs.js";
import {
  inspectGitignoreHealth,
  rebuildAllGitignores,
  updateLoadoutsGitignore,
} from "../../lib/gitignore.js";
import { heading, log } from "../../lib/output.js";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json");

/**
 * Migrate from the legacy single-file gitignore approach to per-target
 * .gitignore files. Runs automatically after a successful version update.
 *
 * Safe to run multiple times — checks whether migration is needed first.
 */
async function migrateGitignore(): Promise<void> {
  let migrated = false;

  const migrateScope = (
    scope: "project" | "global",
    loadoutsDir: string,
    projectRoot: string
  ): void => {
    if (!fileExists(loadoutsDir)) return;

    const health = inspectGitignoreHealth(loadoutsDir, projectRoot, scope);
    if (health.issues === 0) return;

    log.info(`Migrating ${scope} gitignore to per-target format...`);

    rebuildAllGitignores(loadoutsDir, projectRoot, scope);
    updateLoadoutsGitignore(loadoutsDir);

    log.success(`Gitignore migration complete (${scope})`);
    migrated = true;
  };

  const projectRoot = process.cwd();
  migrateScope("project", path.join(projectRoot, ".loadouts"), projectRoot);

  const homeDir = os.homedir();
  migrateScope("global", path.join(homeDir, ".config", "loadouts"), homeDir);

  if (!migrated) {
    log.dim("Gitignore migration already up to date");
  }
}

export const updateCommand = new Command("update")
  .description("Update loadout to the latest version")
  .option("--check", "Check for updates without installing")
  .action(async (opts) => {
    heading("Update");

    const currentVersion = pkg.version;
    log.info(`Current version: ${currentVersion}`);

    // Fetch latest version from npm
    let latestVersion: string;
    try {
      latestVersion = execSync(`npm view ${pkg.name} version`, {
        encoding: "utf-8",
      }).trim();
    } catch {
      log.error("Failed to check for updates. Are you online?");
      process.exit(1);
    }

    if (currentVersion === latestVersion) {
      log.success(`Already on latest version (${currentVersion})`);
      // Still run migration in case they skipped a version
      if (!opts.check) await migrateGitignore();
      return;
    }

    log.info(`Latest version:  ${latestVersion}`);

    if (opts.check) {
      log.plain(`\nRun 'loadout update' to install the update.`);
      return;
    }

    // Perform the update
    log.info(`\nUpdating ${currentVersion} → ${latestVersion}...`);
    try {
      execSync(`npm install -g ${pkg.name}@latest`, {
        stdio: "inherit",
      });
      log.success(`Updated to ${latestVersion}`);
    } catch {
      log.error("Update failed. Try running manually:");
      log.plain(`  npm install -g ${pkg.name}@latest`);
      process.exit(1);
    }

    // Run migrations for the new version
    await migrateGitignore();
  });
