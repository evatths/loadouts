/**
 * loadout install — Import existing tool configurations into loadout.
 *
 * Scans all known tool directories for rules, skills, and instructions,
 * then allows the user to import them into .loadouts/.
 */

import { Command } from "commander";
import * as path from "node:path";
import * as readline from "node:readline";
import * as yaml from "yaml";
import chalk from "chalk";
import {
  discoverImportableArtifacts,
  groupByKind,
  formatSize,
  formatRelativeTime,
  type DiscoveredArtifact,
  type ImportableKind,
  type DiscoveryResult,
} from "../../core/import-discovery.js";
import {
  writeFile,
  readFile,
  fileExists,
  copyFile,
  copyDir,
  removeFile,
  removeDir,
  isDirectory,
  listFiles,
} from "../../lib/fs.js";
import {
  parseLoadoutDefinition,
  sanitizeRuleFile,
  sanitizeSkillFile,
} from "../../core/config.js";
import { loadState } from "../../core/manifest.js";
import { registry } from "../../core/registry.js";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import { rebuildAllGitignores } from "../../lib/gitignore.js";
import { initProjectLoadout } from "./init.js";
import type { CommandContext } from "../../core/types.js";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InstallOptions extends ScopeFlags {
  rules?: boolean;
  skills?: boolean;
  instructions?: boolean;
  kinds?: string;
  from?: string;
  to?: string;       // target loadout (undefined means auto-detect)
  interactive?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  keep?: boolean;
}

interface ImportResult {
  artifact: DiscoveredArtifact;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// User interaction helpers
// ---------------------------------------------------------------------------

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function displayDiscoveryResults(result: DiscoveryResult): void {
  const grouped = groupByKind(result.artifacts);
  const kinds = Object.keys(grouped).sort();

  console.log();
  log.info(`Found ${result.artifacts.length} artifacts to import:`);
  console.log();

  for (const kind of kinds) {
    const items = grouped[kind];
    if (!items || items.length === 0) continue;

    console.log(chalk.bold(`  ${kind.toUpperCase()}`) + chalk.dim(` (${items.length})`));
    for (const artifact of items) {
      const conflict = result.conflicts.has(`${artifact.kind}:${artifact.destPath}`);
      const suffix = conflict ? chalk.yellow(" ⚠ conflict") : "";
      const toolHint = artifact.tool === "project-root" ? "" : chalk.dim(` (${artifact.tool})`);
      console.log(chalk.dim("    ○ ") + artifact.displayPath + toolHint + suffix);
    }
    console.log();
  }

  // Show conflict details
  if (result.conflicts.size > 0) {
    console.log(chalk.yellow(`  ⚠ ${result.conflicts.size} naming conflict(s) detected`));
    console.log(chalk.dim("    Conflicts will be resolved during import"));
    console.log();
  }

  if (result.warnings.length > 0) {
    console.log(chalk.yellow(`  ⚠ ${result.warnings.length} discovery warning(s)`));
    for (const warning of result.warnings.slice(0, 5)) {
      console.log(chalk.dim(`    - ${warning}`));
    }
    if (result.warnings.length > 5) {
      console.log(chalk.dim(`    - ... and ${result.warnings.length - 5} more`));
    }
    console.log();
  }
}

function displayImportTable(results: ImportResult[], targetLoadout: string, keep: boolean): void {
  console.log();
  heading("Import Summary");
  console.log();

  const maxSourceLen = Math.max(...results.map((r) => r.artifact.displayPath.length), 10);

  // Header
  console.log(
    chalk.dim("  ") +
      "Source".padEnd(maxSourceLen + 2) +
      "→  " +
      "Destination"
  );
  console.log(chalk.dim("  " + "─".repeat(maxSourceLen + 30)));

  // Rows
  for (const result of results) {
    const source = result.artifact.displayPath.padEnd(maxSourceLen + 2);
    const dest = `.loadouts/${result.artifact.destPath}`;
    
    if (result.success) {
      console.log(chalk.green("  ✓ ") + source + chalk.dim("→  ") + dest);
    } else {
      console.log(chalk.red("  ✗ ") + source + chalk.dim("→  ") + chalk.red(result.error || "failed"));
    }
  }

  console.log();

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  if (failCount === 0) {
    log.success(`Imported ${successCount} artifact${successCount !== 1 ? "s" : ""} to ${chalk.cyan(targetLoadout)} loadout`);
  } else {
    log.warn(`Imported ${successCount}, failed ${failCount}`);
  }

  if (!keep && successCount > 0) {
    log.dim("  Original files have been removed");
  }
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

async function resolveConflicts(
  result: DiscoveryResult,
  rl: readline.Interface
): Promise<DiscoveredArtifact[]> {
  const resolved: DiscoveredArtifact[] = [];
  const seen = new Set<string>();

  for (const artifact of result.artifacts) {
    const key = `${artifact.kind}:${artifact.destPath}`;

    // Skip if we've already handled this conflict
    if (seen.has(key)) continue;

    const conflicting = result.conflicts.get(key);
    if (!conflicting || conflicting.length <= 1) {
      // No conflict, include as-is
      resolved.push(artifact);
      seen.add(key);
      continue;
    }

    // Handle conflict
    seen.add(key);
    console.log();
    console.log(chalk.yellow(`⚠ Conflict: '${artifact.name}' exists in multiple locations:`));
    console.log();

    for (let i = 0; i < conflicting.length; i++) {
      const c = conflicting[i];
      const sizeStr = formatSize(c.size);
      const timeStr = formatRelativeTime(c.mtime);
      console.log(`  ${i + 1}. ${c.displayPath} (${sizeStr}, ${timeStr})`);
    }

    console.log();
    console.log("How to resolve?");
    for (let i = 0; i < conflicting.length; i++) {
      console.log(`  [${i + 1}] Keep ${conflicting[i].tool} version`);
    }
    console.log("  [s] Skip this artifact");
    console.log("  [b] Import both (rename)");
    console.log();

    const answer = await askQuestion(rl, "Choice: ");

    if (answer === "s") {
      // Skip
      continue;
    } else if (answer === "b") {
      // Import both with renamed destinations
      for (const c of conflicting) {
        const renamed = { ...c };
        const toolSuffix = c.tool === "project-root" ? "" : `-${c.tool}`;
        const ext = path.extname(c.destPath);
        renamed.destPath = ext
          ? `${c.destPath.slice(0, -ext.length)}${toolSuffix}${ext}`
          : `${c.destPath}${toolSuffix}`;
        resolved.push(renamed);
      }
    } else {
      // Pick specific version
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < conflicting.length) {
        resolved.push(conflicting[idx]);
      } else {
        // Invalid input, default to first (newest by mtime)
        const sorted = [...conflicting].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        resolved.push(sorted[0]);
      }
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Import logic
// ---------------------------------------------------------------------------

async function importArtifact(
  artifact: DiscoveredArtifact,
  loadoutPath: string,
  options: { keep: boolean; dryRun: boolean }
): Promise<ImportResult> {
  const destPath = path.join(loadoutPath, artifact.destPath);
  const kind = registry.getKind(artifact.kind);

  if (options.dryRun) {
    return { artifact, success: true };
  }

  try {
    if (kind?.layout === "dir") {
      // Copy directory
      copyDir(artifact.sourcePath, destPath);

      if (artifact.kind === "skill") {
        sanitizeSkillFile(path.join(destPath, "SKILL.md"));
      }
    } else {
      // Copy file
      copyFile(artifact.sourcePath, destPath);

      // Canonicalize known native frontmatter aliases on import.
      if (artifact.kind === "rule") {
        sanitizeRuleFile(destPath);
      }
    }

    // Remove original unless --keep
    if (!options.keep) {
      if (kind?.layout === "dir") {
        removeDir(artifact.sourcePath);
      } else {
        removeFile(artifact.sourcePath);
      }
    }

    return { artifact, success: true };
  } catch (err) {
    return {
      artifact,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function addToLoadout(
  artifacts: DiscoveredArtifact[],
  loadoutPath: string,
  loadoutName: string
): Promise<void> {
  const loadoutDefPath = path.join(loadoutPath, "loadouts", `${loadoutName}.yaml`);

  if (!fileExists(loadoutDefPath)) {
    return; // Loadout doesn't exist, skip
  }

  try {
    const def = parseLoadoutDefinition(loadoutDefPath);
    let modified = false;

    for (const artifact of artifacts) {
      const includeEntry = artifact.destPath;

      const alreadyIncluded = def.include.some(
        (i) => (typeof i === "string" ? i : i.path) === includeEntry
      );

      if (!alreadyIncluded) {
        def.include.push(includeEntry);
        modified = true;
      }
    }

    if (modified) {
      writeFile(loadoutDefPath, yaml.stringify(def));
    }
  } catch {
    // Ignore errors updating loadout
  }
}

// ---------------------------------------------------------------------------
// Target loadout resolution
// ---------------------------------------------------------------------------

/**
 * Get list of available loadouts in .loadouts/loadouts/
 */
function getAvailableLoadouts(loadoutPath: string): string[] {
  const loadoutsDir = path.join(loadoutPath, "loadouts");
  if (!isDirectory(loadoutsDir)) return [];
  
  return listFiles(loadoutsDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
}

/**
 * Resolve the target loadout for imports.
 * 
 * Priority:
 * 1. Explicit --loadout flag
 * 2. Single active loadout → use it
 * 3. Multiple active → prompt (or first with --yes)
 * 4. None active → default to "base"
 */
async function resolveTargetLoadout(
  loadoutPath: string,
  options: InstallOptions,
  rl?: readline.Interface
): Promise<{ loadout: string; confirmed: boolean }> {
  // If explicitly specified, use it
  if (options.to) {
    return { loadout: options.to, confirmed: true };
  }

  const state = loadState(loadoutPath);
  const activeLoadouts = state?.active ?? [];
  const availableLoadouts = getAvailableLoadouts(loadoutPath);

  // Single active loadout → use it
  if (activeLoadouts.length === 1) {
    return { loadout: activeLoadouts[0], confirmed: true };
  }

  // Multiple active loadouts
  if (activeLoadouts.length > 1) {
    if (options.yes) {
      // Auto mode: use first active
      return { loadout: activeLoadouts[0], confirmed: true };
    }

    if (rl) {
      console.log();
      console.log(chalk.yellow("Multiple loadouts are active:"));
      for (let i = 0; i < activeLoadouts.length; i++) {
        console.log(`  ${i + 1}. ${activeLoadouts[i]}`);
      }
      console.log();

      const answer = await askQuestion(
        rl,
        `Add imports to which loadout? [1-${activeLoadouts.length}] `
      );

      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < activeLoadouts.length) {
        return { loadout: activeLoadouts[idx], confirmed: true };
      }
      // Default to first if invalid input
      return { loadout: activeLoadouts[0], confirmed: true };
    }

    // No rl, use first
    return { loadout: activeLoadouts[0], confirmed: true };
  }

  // No active loadouts → default to "base" if it exists
  if (availableLoadouts.includes("base")) {
    return { loadout: "base", confirmed: true };
  }

  // Fall back to first available, or "base" if none
  if (availableLoadouts.length > 0) {
    return { loadout: availableLoadouts[0], confirmed: true };
  }

  return { loadout: "base", confirmed: true };
}

// ---------------------------------------------------------------------------
// Main install function (exported for use by init command)
// ---------------------------------------------------------------------------

export interface InstallResult {
  imported: number;
  skipped: number;
  failed: number;
}

export async function runInstall(
  ctx: CommandContext,
  options: InstallOptions
): Promise<InstallResult> {
  const projectRoot = ctx.projectRoot;
  const loadoutPath = ctx.configPath;

  // Build filter options
  const kinds: ImportableKind[] | undefined = (() => {
    const selected = new Set<ImportableKind>();
    if (options.rules) selected.add("rule");
    if (options.skills) selected.add("skill");
    if (options.instructions) selected.add("instruction");

    if (options.kinds) {
      for (const kind of options.kinds.split(",").map((k) => k.trim()).filter(Boolean)) {
        selected.add(kind);
      }
    }

    return selected.size > 0 ? [...selected] : undefined;
  })();

  const tools = options.from?.split(",").map((t) => t.trim());

  // Discover artifacts
  const result = discoverImportableArtifacts(projectRoot, {
    scope: ctx.scope,
    tools,
    kinds,
    loadoutPath,
  });

  if (result.artifacts.length === 0) {
    log.dim("No existing configurations found to import.");
    return { imported: 0, skipped: 0, failed: 0 };
  }

  // Display what we found
  displayDiscoveryResults(result);

  let artifactsToImport: DiscoveredArtifact[];

  if (options.yes) {
    // Auto-confirm: resolve conflicts by taking newest
    artifactsToImport = [];
    const seen = new Set<string>();

    for (const artifact of result.artifacts) {
      const key = `${artifact.kind}:${artifact.destPath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const conflicting = result.conflicts.get(key);
      if (conflicting && conflicting.length > 1) {
        // Take newest
        const sorted = [...conflicting].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        artifactsToImport.push(sorted[0]);
      } else {
        artifactsToImport.push(artifact);
      }
    }
  } else if (options.interactive) {
    // Interactive selection mode
    const rl = createPrompt();

    try {
      // First resolve conflicts
      artifactsToImport = await resolveConflicts(result, rl);

      // Then let user deselect items
      console.log();
      console.log("Selected artifacts:");
      for (let i = 0; i < artifactsToImport.length; i++) {
        console.log(`  ${i + 1}. ${artifactsToImport[i].displayPath}`);
      }
      console.log();

      const answer = await askQuestion(
        rl,
        "Enter numbers to exclude (comma-separated), or press Enter to import all: "
      );

      if (answer) {
        const exclude = new Set(
          answer.split(",").map((n) => parseInt(n.trim(), 10) - 1)
        );
        artifactsToImport = artifactsToImport.filter((_, i) => !exclude.has(i));
      }

      rl.close();
    } catch {
      rl.close();
      throw new Error("Interactive mode cancelled");
    }
  } else {
    // Default: prompt for confirmation
    const rl = createPrompt();

    try {
      const answer = await askQuestion(
        rl,
        `Import all ${result.artifacts.length} artifacts? [Y/n/i] `
      );

      if (answer === "n" || answer === "no") {
        rl.close();
        log.dim("Import cancelled.");
        return { imported: 0, skipped: result.artifacts.length, failed: 0 };
      }

      if (answer === "i") {
        // Switch to interactive mode
        rl.close();
        return runInstall(ctx, { ...options, interactive: true });
      }

      // Resolve conflicts automatically (take newest)
      artifactsToImport = [];
      const seen = new Set<string>();

      for (const artifact of result.artifacts) {
        const key = `${artifact.kind}:${artifact.destPath}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const conflicting = result.conflicts.get(key);
        if (conflicting && conflicting.length > 1) {
          // Prompt for each conflict
          console.log();
          console.log(chalk.yellow(`⚠ Conflict: '${artifact.name}'`));
          for (let i = 0; i < conflicting.length; i++) {
            const c = conflicting[i];
            console.log(`  ${i + 1}. ${c.displayPath} (${formatRelativeTime(c.mtime)})`);
          }

          const choice = await askQuestion(rl, `Which to keep? [1-${conflicting.length}/s=skip]: `);

          if (choice === "s") {
            continue;
          }

          const idx = parseInt(choice, 10) - 1;
          if (idx >= 0 && idx < conflicting.length) {
            artifactsToImport.push(conflicting[idx]);
          } else {
            // Default to newest
            const sorted = [...conflicting].sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            artifactsToImport.push(sorted[0]);
          }
        } else {
          artifactsToImport.push(artifact);
        }
      }

      rl.close();
    } catch {
      rl.close();
      throw new Error("Import cancelled");
    }
  }

  if (artifactsToImport.length === 0) {
    log.dim("No artifacts selected for import.");
    return { imported: 0, skipped: result.artifacts.length, failed: 0 };
  }

  // Resolve target loadout (may prompt if multiple active)
  const rl2 = options.yes ? undefined : createPrompt();
  const { loadout: targetLoadout } = await resolveTargetLoadout(loadoutPath, options, rl2);
  rl2?.close();

  // Confirm target loadout if not using --yes
  if (!options.yes && !options.to) {
    const rl3 = createPrompt();
    const confirm = await askQuestion(
      rl3,
      `Add to ${chalk.cyan(targetLoadout)} loadout? [Y/n] `
    );
    rl3.close();
    
    if (confirm === "n" || confirm === "no") {
      log.dim("Import cancelled.");
      return { imported: 0, skipped: result.artifacts.length, failed: 0 };
    }
  }

  // Update instruction destPaths to use the target loadout name
  for (const artifact of artifactsToImport) {
    if (artifact.kind === "instruction") {
      artifact.destPath = `instructions/AGENTS.${targetLoadout}.md`;
    }
  }

  // Perform import
  if (options.dryRun) {
    console.log();
    log.info("Dry run — no changes made");
    displayImportTable(
      artifactsToImport.map((a) => ({ artifact: a, success: true })),
      targetLoadout,
      options.keep ?? false
    );
    return { imported: artifactsToImport.length, skipped: 0, failed: 0 };
  }

  const results: ImportResult[] = [];
  for (const artifact of artifactsToImport) {
    const importResult = await importArtifact(artifact, loadoutPath, {
      keep: options.keep ?? false,
      dryRun: false,
    });
    results.push(importResult);
  }

  // Add successful imports to loadout definition
  const successfulArtifacts = results
    .filter((r) => r.success)
    .map((r) => r.artifact);

  if (successfulArtifacts.length > 0) {
    await addToLoadout(successfulArtifacts, loadoutPath, targetLoadout);

    // Rebuild per-target .gitignore files for all artifacts after import
    rebuildAllGitignores(loadoutPath, projectRoot, "project");
  }

  // Display results
  displayImportTable(results, targetLoadout, options.keep ?? false);

  const imported = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const skipped = result.artifacts.length - artifactsToImport.length;

  if (imported > 0) {
    console.log();
    log.info(`Run ${chalk.cyan("loadouts sync")} to apply changes to tool directories.`);
  }

  return { imported, skipped, failed };
}

// ---------------------------------------------------------------------------
// CLI Command
// ---------------------------------------------------------------------------

export const installCommand = new Command("install")
  .description("Import existing tool configurations into loadout")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--rules", "Only import rules")
  .option("--skills", "Only import skills")
  .option("--instructions", "Only import instructions")
  .option("--kinds <kinds>", "Only import specific kind IDs (comma-separated)")
  .option("--from <tools>", "Only from specific tools (comma-separated)")
  .option("-i, --interactive", "Interactive selection mode")
  .option("-y, --yes", "Auto-confirm without prompting")
  .option("--dry-run", "Preview changes without applying")
  .option("--keep", "Keep original files after import")
  .option("--to <loadout>", "Target loadout to add artifacts to (default: auto-detect from active)")
  .action(async (options: InstallOptions) => {
    const cwd = process.cwd();

    let contexts: CommandContext[] = [];

    try {
      ({ contexts } = await resolveContexts(options, cwd));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const canAutoInitProject =
        !options.global &&
        !options.all &&
        message.includes("No loadout found");

      if (!canAutoInitProject) {
        log.error(message);
        process.exit(1);
      }

      console.log();
      log.warn("No project .loadouts/ found.");

      if (!options.yes) {
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question("Initialize one now? [Y/n] ", (ans) => {
            resolve(ans.trim().toLowerCase());
            rl.close();
          });
        });

        if (answer === "n" || answer === "no") {
          log.dim("Run 'loadouts init' to set up a project loadout.");
          process.exit(0);
        }
      } else {
        log.info("Auto-initializing project loadout...");
      }

      console.log();
      if (options.dryRun) {
        log.info("Would initialize .loadouts/ (dry-run)");
        const configPath = path.join(cwd, ".loadouts");
        contexts = [
          {
            scope: "project",
            configPath,
            statePath: path.join(configPath, ".state.json"),
            projectRoot: cwd,
          },
        ];
      } else {
        const configPath = await initProjectLoadout(cwd);
        contexts = [
          {
            scope: "project",
            configPath,
            statePath: path.join(configPath, ".state.json"),
            projectRoot: cwd,
          },
        ];
      }
    }

    const multipleScopes = contexts.length > 1;
    let hasFailures = false;

    for (const ctx of contexts) {
      console.log();
      const scopeLabel = ctx.scope === "global" ? " [global]" : " [project]";
      log.info(`Scanning for existing configurations${multipleScopes ? scopeLabel : ""}...`);

      try {
        const result = await runInstall(ctx, options);
        if (result.failed > 0) {
          hasFailures = true;
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes("cancelled")) {
          continue;
        }
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    if (hasFailures) {
      process.exit(1);
    }
  });
