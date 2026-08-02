/**
 * loadout sync — Re-render current active loadouts from latest definitions.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → sync both scopes (default)
 *   (none)         → all available scopes
 *
 * On fresh clone (no state), automatically applies the default loadout.
 */

import { Command } from "commander";
import { loadState } from "../../core/manifest.js";
import { parseRootConfig } from "../../core/config.js";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { computeSyncSet } from "./policy.js";
import { applyTargetSet } from "./render-engine.js";
import { rebuildAllGitignores } from "../../lib/gitignore.js";
import { log } from "../../lib/output.js";

interface SyncOptions extends ScopeFlags {
  dryRun?: boolean;
}

export const syncCommand = new Command("sync")
  .description("Re-render current active loadouts from latest definitions")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--dry-run", "Preview changes without applying")
  .action(async (options: SyncOptions) => {
    const { contexts } = await resolveContexts(options);

    let synced = false;

    for (const ctx of contexts) {
      const state = loadState(ctx.configPath);
      let current = state?.active ?? [];

      // Fresh clone: no state exists, apply default loadout
      if (!state) {
        const rootConfig = parseRootConfig(ctx.configPath);
        const defaultLoadout = rootConfig.default ?? "base";
        log.info(`[${ctx.scope}] No state found, applying default loadout '${defaultLoadout}'...`);
        current = [defaultLoadout];
      }

      const { targets, earlyExit } = computeSyncSet(current);

      if (earlyExit) {
        log.dim(`[${ctx.scope}] ${earlyExit}`);
        continue;
      }

      await applyTargetSet(ctx, targets, {
        dryRun: options.dryRun,
        verb: state ? "Synced" : "Applied",
      });
      synced = true;

      // Rebuild per-target .gitignore files so rendered artifacts are ignored
      // even when definitions were added/edited outside `add`/`install`.
      if (!options.dryRun) {
        rebuildAllGitignores(ctx.configPath, ctx.projectRoot, ctx.scope);
      }
    }

    if (!synced) {
      log.warn("No active loadouts to sync.");
    }
  });
