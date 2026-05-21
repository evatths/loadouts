import { Command } from "commander";
import chalk from "chalk";
import { SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import {
  normalizeIncludePath,
  removeIncludes,
  resolveLoadoutMutationTarget,
  writeLoadoutDefinition,
  type IncludeMutationResult,
} from "./loadout-include.js";

export interface RemoveFromResult extends IncludeMutationResult {
  loadout: string;
}

export async function runRemoveFrom(
  loadout: string,
  artifacts: string[],
  options: ScopeFlags,
  cwd: string = process.cwd()
): Promise<RemoveFromResult> {
  if (artifacts.length === 0) {
    throw new Error("Provide at least one artifact path.");
  }

  const target = await resolveLoadoutMutationTarget(loadout, options, cwd);
  const includePaths = artifacts.map((artifact) => normalizeIncludePath(artifact, target.ctx.configPath));
  const result = removeIncludes(target.definition, includePaths);

  if (result.changed.length > 0) {
    writeLoadoutDefinition(target.loadoutPath, target.definition);
  }

  return { loadout, ...result };
}

function printResult(result: RemoveFromResult): void {
  if (result.changed.length === 0) {
    log.dim(`No changes to ${result.loadout}.`);
  } else {
    heading(`Removed from ${result.loadout}`);
    for (const includePath of result.changed) {
      console.log(chalk.red(`- ${includePath}`));
    }
  }

  for (const skipped of result.skipped) {
    console.log(chalk.dim(`- ${skipped.path} ${skipped.reason}`));
  }

  if (result.changed.length > 0) {
    console.log();
    log.info(`Run ${chalk.cyan("loadouts sync")} to apply changes.`);
  }
}

export const removeFromCommand = new Command("remove-from")
  .description("Remove artifacts from a loadout without deleting files")
  .argument("<loadout>", "Loadout to update")
  .argument("<artifacts...>", "Artifact paths relative to .loadouts/")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .action(async (loadout: string, artifacts: string[], options: ScopeFlags) => {
    try {
      printResult(await runRemoveFrom(loadout, artifacts, options));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
