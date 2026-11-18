/**
 * loadout clear — Deactivate all loadouts and remove outputs.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → clear both scopes (default)
 *   (none)         → all available scopes
 */

import { Command } from "commander";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { clearAllOutputs } from "./render-engine.js";
import { privateProject } from "./private.js";
import { updatePrivateSelection } from "../../core/private-project.js";
import { log } from "../../lib/output.js";

interface ClearOptions extends ScopeFlags {
  dryRun?: boolean;
}

export const clearCommand = new Command("clear")
  .description("Deactivate all loadouts and remove outputs")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--dry-run", "Preview changes without applying")
  .action(async (options: ClearOptions) => {
    const project = await privateProject(options, process.cwd(), true);
    if (project) {
      if (options.dryRun) log.info("Would restore native defaults.");
      else { await updatePrivateSelection(project, () => undefined); log.success("Restored native defaults."); }
      return;
    }
    const { contexts } = await resolveContexts(options);

    for (const ctx of contexts) {
      await clearAllOutputs(ctx, { dryRun: options.dryRun });
    }
  });
