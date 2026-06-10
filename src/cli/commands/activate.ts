/**
 * loadout activate — Add loadout(s) to the active set.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → activate in both scopes
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
import { computeActivateSet } from "./policy.js";
import { applyTargetSet } from "./render-engine.js";
import { log } from "../../lib/output.js";
import type { Scope } from "../../core/types.js";

interface ActivateOptions extends ScopeFlags {
  dryRun?: boolean;
}

export const activateCommand = new Command("activate")
  .alias("a")
  .description("Activate loadout(s) (add to active set)")
  .argument("<names...>", "Loadout names to activate")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--dry-run", "Preview changes without applying")
  .action(async (names: string[], options: ActivateOptions) => {
    const cwd = process.cwd();

    // If --all, activate in both scopes
    if (options.all) {
      const { contexts } = await resolveContexts(options, cwd);
      for (const ctx of contexts) {
        const current = loadState(ctx.configPath)?.active ?? [];
        const { targets, earlyExit } = computeActivateSet(current, names);

        if (earlyExit) {
          log.warn(`[${ctx.scope}] ${earlyExit}`);
          continue;
        }

        await applyTargetSet(ctx, targets, {
          dryRun: options.dryRun,
          verb: "Activated",
          showKindNamespaceNotes: true,
        });
      }
      return;
    }

    // Otherwise, resolve each name to its scope
    // For simplicity, require all names to resolve to the same scope
    // (or use explicit -l/-g)
    let targetScope: Scope;

    if (options.local) {
      targetScope = "project";
    } else if (options.global) {
      targetScope = "global";
    } else {
      // Auto-detect from first name, require all to match
      try {
        targetScope = await requireScopeForName(names[0], options, cwd);
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Verify all names exist in that scope (let the render engine handle actual validation)
    }

    const ctx = await getContext(targetScope, cwd);
    const current = loadState(ctx.configPath)?.active ?? [];
    const { targets, earlyExit } = computeActivateSet(current, names);

    if (earlyExit) {
      log.error(earlyExit);
      process.exit(1);
    }

    await applyTargetSet(ctx, targets, {
      dryRun: options.dryRun,
      verb: "Activated",
      showKindNamespaceNotes: true,
    });
  });
