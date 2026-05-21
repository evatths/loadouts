import { Command } from "commander";
import chalk from "chalk";
import { SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import {
  addIncludes,
  normalizeAndValidateArtifact,
  parseToolsOption,
  resolveLoadoutMutationTarget,
  writeLoadoutDefinition,
  type IncludeMutationResult,
} from "./loadout-include.js";

interface AddToOptions extends ScopeFlags {
  tools?: string;
}

export interface AddToResult extends IncludeMutationResult {
  loadout: string;
}

export async function runAddTo(
  loadout: string,
  artifacts: string[],
  options: AddToOptions,
  cwd: string = process.cwd()
): Promise<AddToResult> {
  if (artifacts.length === 0) {
    throw new Error("Provide at least one artifact path.");
  }

  const target = await resolveLoadoutMutationTarget(loadout, options, cwd);
  const tools = parseToolsOption(options.tools);
  const includes = artifacts.map((artifact) => ({
    ...normalizeAndValidateArtifact(artifact, target.ctx.configPath),
    tools,
  }));

  const result = addIncludes(target.definition, includes);
  if (result.changed.length > 0) {
    writeLoadoutDefinition(target.loadoutPath, target.definition);
  }

  return { loadout, ...result };
}

function printResult(result: AddToResult): void {
  if (result.changed.length === 0) {
    log.dim(`No changes to ${result.loadout}.`);
  } else {
    heading(`Added to ${result.loadout}`);
    for (const includePath of result.changed) {
      console.log(chalk.green(`+ ${includePath}`));
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

export const addToCommand = new Command("add-to")
  .description("Add existing artifacts to a loadout")
  .argument("<loadout>", "Loadout to update")
  .argument("<artifacts...>", "Artifact paths relative to .loadouts/")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option("--tools <tools>", "Restrict added artifacts to specific tools (comma-separated)")
  .action(async (loadout: string, artifacts: string[], options: AddToOptions) => {
    try {
      printResult(await runAddTo(loadout, artifacts, options));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
