/**
 * loadout deactivate — Remove loadout(s) from the active set.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → deactivate in both scopes
 *   (none)         → auto-detect; error if name exists in both
 */

import { Command } from "commander";
import { getContext } from "../../core/discovery.js";
import { loadState } from "../../core/manifest.js";
import {
  resolveContexts,
  requireScopeForName,
  SCOPE_FLAGS,
  type ScopeFlags,
} from "../../core/scope.js";
import { computeDeactivateSet } from "./policy.js";
import { applyTargetSet } from "./render-engine.js";
import { log } from "../../lib/output.js";
import type { Scope } from "../../core/types.js";
import { privateSelection } from "./private.js";

interface DeactivateOptions extends ScopeFlags {
  dryRun?: boolean;
}

export const deactivateCommand = new Command("deactivate")
  .alias("d")
  .description("Deactivate loadout(s) (remove from active set)")
  .argument("<names...>", "Loadout names to deactivate")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--dry-run", "Preview changes without applying")
  .action(async (names: string[], options: DeactivateOptions) => {
    if (await privateSelection("deactivate", names, options)) return;
    const cwd = process.cwd();

    // If --all, deactivate in both scopes
    if (options.all) {
      const { contexts } = await resolveContexts(options, cwd);
      for (const ctx of contexts) {
        const current = loadState(ctx.configPath)?.active ?? [];
        const { targets, earlyExit } = computeDeactivateSet(current, names);

        if (earlyExit) {
          // Not an error for deactivate — just nothing to do
          log.dim(`[${ctx.scope}] ${earlyExit}`);
          continue;
        }

        await applyTargetSet(ctx, targets, {
          dryRun: options.dryRun,
          verb: "Deactivated",
        });
      }
      return;
    }

    // Otherwise, resolve each name to its scope
    let targetScope: Scope;

    if (options.local) {
      targetScope = "project";
    } else if (options.global) {
      targetScope = "global";
    } else {
      try {
        targetScope = await requireScopeForName(names[0], options, cwd);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    const ctx = await getContext(targetScope, cwd);
    const current = loadState(ctx.configPath)?.active ?? [];
    const { targets, earlyExit } = computeDeactivateSet(current, names);

    if (earlyExit) {
      log.warn(earlyExit);
      return;
    }

    await applyTargetSet(ctx, targets, {
      dryRun: options.dryRun,
      verb: "Deactivated",
    });
  });
