/**
 * loadout check — Validate a loadout.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → check both scopes (default)
 *   (none)         → all available scopes
 */

import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";
import {
  findNearestLoadoutRoot,
  getGlobalRoot,
  getProjectRoot,
} from "../../core/discovery.js";
import {
  parseRootConfig,
  listLoadouts,
  parseLoadoutDefinition,
  findUnsanitizedRules,
  findUnsanitizedSkills,
} from "../../core/config.js";
import { resolveLoadout, getInstructionItem } from "../../core/resolve.js";
import { planRender } from "../../core/render.js";
import { registry } from "../../core/registry.js";
import { resolveScopes, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { fileExists } from "../../lib/fs.js";
import { log, heading, list } from "../../lib/output.js";
import type { LoadoutRoot, Scope } from "../../core/types.js";

interface CheckOptions extends ScopeFlags {
  verbose?: boolean;
}

async function checkRoot(
  root: LoadoutRoot,
  projectRoot: string,
  scope: Scope,
  verbose: boolean
): Promise<{ errors: boolean; warnings: boolean }> {
  let hasErrors = false;
  let hasWarnings = false;

  const scopeLabel = scope === "global" ? "Global" : "Project";
  log.info(`Checking ${scopeLabel} (${root.path})`);

  // Check root config
  try {
    parseRootConfig(root.path);
    if (verbose) {
      log.success("  loadouts.yaml valid");
    }
  } catch (err) {
    log.error(
      `  loadouts.yaml invalid: ${err instanceof Error ? err.message : String(err)}`
    );
    hasErrors = true;
  }

  // Check each loadout definition
  const loadoutNames = listLoadouts(root.path);

  const unsanitizedRules = findUnsanitizedRules(root.path);
  const unsanitizedSkills = findUnsanitizedSkills(root.path);
  if (unsanitizedRules.length > 0 || unsanitizedSkills.length > 0) {
    const total = unsanitizedRules.length + unsanitizedSkills.length;
    log.warn(`  ${total} artifact(s) have non-canonical frontmatter`);
    if (verbose) {
      for (const name of unsanitizedRules) {
        log.dim(`    rule: ${name}`);
      }
      for (const name of unsanitizedSkills) {
        log.dim(`    skill: ${name}`);
      }
    }
    log.dim("    Run 'loadouts sanitize' to fix.");
    hasWarnings = true;
  }

  for (const name of loadoutNames) {
    const defPath = path.join(root.path, "loadouts", `${name}.yaml`);
    const ymlPath = path.join(root.path, "loadouts", `${name}.yml`);
    const filePath = fileExists(defPath) ? defPath : ymlPath;

    try {
      parseLoadoutDefinition(filePath);
      if (verbose) {
        log.success(`  loadouts/${name}.yaml valid`);
      }
    } catch (err) {
      log.error(
        `  loadouts/${name}.yaml invalid: ${err instanceof Error ? err.message : String(err)}`
      );
      hasErrors = true;
      continue;
    }

    // Try to resolve the loadout
    try {
      const loadout = resolveLoadout(name, [root]);
      if (verbose) {
        log.success(`  loadouts/${name}.yaml resolves`);
      }

      // Dry-run apply to check for collisions
      const instructionItem = getInstructionItem(root.path, loadout.tools);
      if (instructionItem) {
        loadout.items.push(instructionItem);
      }

      const plan = await planRender(loadout, projectRoot, scope, root.path);

      if (plan.errors.length > 0) {
        log.warn(`  ${name}: ${plan.errors.length} render errors`);
        if (verbose) {
          list(plan.errors);
        }
        hasWarnings = true;
      }

      if (plan.shadowed.length > 0) {
        log.warn(
          `  ${name}: ${plan.shadowed.length} outputs would be shadowed by unmanaged files`
        );
        if (verbose) {
          list(plan.shadowed.map((s) => s.targetPath));
        }
        hasWarnings = true;
      }
    } catch (err) {
      log.error(
        `  ${name}: failed to resolve: ${err instanceof Error ? err.message : String(err)}`
      );
      hasErrors = true;
    }
  }

  return { errors: hasErrors, warnings: hasWarnings };
}

export const checkCommand = new Command("check")
  .alias("c")
  .description("Validate a loadout")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("-v, --verbose", "Show detailed validation output")
  .action(async (options: CheckOptions) => {
    const cwd = process.cwd();
    const scopes = await resolveScopes(options, cwd);

    let hasErrors = false;
    let hasWarnings = false;

    heading("Checking loadout");
    console.log();

    for (const scope of scopes) {
      let root: LoadoutRoot | null = null;
      let projectRoot: string;

      if (scope === "project") {
        root = await findNearestLoadoutRoot(cwd);
        projectRoot = await getProjectRoot(cwd);
      } else {
        root = getGlobalRoot();
        projectRoot = os.homedir();
      }

      if (!root) continue;

      const result = await checkRoot(root, projectRoot, scope, !!options.verbose);
      hasErrors = hasErrors || result.errors;
      hasWarnings = hasWarnings || result.warnings;
      console.log();
    }

    // Check tool prerequisites
    log.info("Checking tool prerequisites");

    for (const tool of registry.allTools()) {
      if (tool.validate) {
        const result = await tool.validate("project");

        if (result.errors.length > 0) {
          log.error(`  ${tool.name}:`);
          list(result.errors);
          hasErrors = true;
        } else if (result.warnings.length > 0) {
          log.warn(`  ${tool.name}:`);
          list(result.warnings);
          hasWarnings = true;
        } else if (options.verbose) {
          log.success(`  ${tool.name}: OK`);
        }
      }
    }

    // Summary
    console.log();
    if (hasErrors) {
      log.error("Validation failed with errors");
      process.exit(1);
    } else if (hasWarnings) {
      log.warn("Validation passed with warnings");
    } else {
      log.success("All checks passed");
    }
  });
