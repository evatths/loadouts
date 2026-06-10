/**
 * Render engine — the mechanism behind loadout operations.
 *
 * Single responsibility: given a target set of loadout names, resolve, plan,
 * and render them to disk. Policy decisions (what the target set should be)
 * live in policy.ts; this module is pure mechanism.
 *
 * Output follows the unified visual language (see docs/visual-language.md):
 * - Artifacts as rows, tools as columns
 * - Consistent change indicators (+, ~, -, ✓)
 */

import { loadResolvedLoadouts } from "../../core/resolve.js";
import { parseRootConfig } from "../../core/config.js";
import { planRender, applyMultiPlan, removeManaged } from "../../core/render.js";
import { loadState, clearState } from "../../core/manifest.js";
import { log, heading, list } from "../../lib/output.js";
import {
  groupOutputsByArtifact,
  renderChangeTable,
  renderChangeSummary,
  renderDryRunSummary,
  type ChangeType,
} from "../../lib/artifact-table.js";
import type { CommandContext, ResolvedLoadout, RenderPlan, Tool } from "../../core/types.js";

export interface ApplyOptions {
  dryRun?: boolean;
  /** Verb for output heading (e.g., "Activated", "Synced"). Defaults to "Applied". */
  verb?: string;
  showKindNamespaceNotes?: boolean;
}

export interface ApplyResult {
  applied: boolean;
  totalOutputs: number;
}

/**
 * Resolve multiple loadouts and their render plans.
 */
async function resolveMultipleLoadouts(
  names: string[],
  ctx: CommandContext,
  options: { showKindNamespaceNotes?: boolean } = {}
): Promise<Array<{ loadout: ResolvedLoadout; plan: RenderPlan }>> {
  const { loadouts } = await loadResolvedLoadouts(ctx, names, {
    includeBundled: true,
    showKindNamespaceNotes: options.showKindNamespaceNotes,
  });
  const results: Array<{ loadout: ResolvedLoadout; plan: RenderPlan }> = [];

  for (const loadout of loadouts) {
    const plan = await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath);

    if (plan.errors.length > 0) {
      log.error(`Errors planning "${loadout.name}":`);
      list(plan.errors);
      process.exit(1);
    }

    results.push({ loadout, plan });
  }

  return results;
}

/**
 * Clear all loadout outputs and state.
 */
export async function clearAllOutputs(
  ctx: CommandContext,
  options: { dryRun?: boolean } = {}
): Promise<void> {
  if (options.dryRun) {
    const state = loadState(ctx.configPath);
    const count = state?.entries.length ?? 0;
    heading(`Would clear all loadouts (${ctx.scope})`);
    log.dim(`  ${count} outputs would be removed`);
    return;
  }

  const { removed } = await removeManaged(ctx.configPath, ctx.projectRoot, ctx.scope);
  clearState(ctx.configPath);
  heading(`Cleared all loadouts (${ctx.scope})`);
  log.success(`${removed.length} outputs removed`);
}

/**
 * Apply a target set of loadouts.
 *
 * This is the core mechanism: resolve the named loadouts, plan their outputs,
 * and write them to disk. Caller is responsible for computing what the target
 * set should be (see policy.ts).
 */
export async function applyTargetSet(
  ctx: CommandContext,
  targets: string[],
  options: ApplyOptions = {}
): Promise<ApplyResult> {
  const { dryRun, verb = "Applied", showKindNamespaceNotes } = options;

  // Empty target set means clear — delegate to clearAllOutputs
  if (targets.length === 0) {
    await clearAllOutputs(ctx, { dryRun });
    return { applied: true, totalOutputs: 0 };
  }

  // Resolve all target loadouts
  let plans;
  try {
    plans = await resolveMultipleLoadouts(targets, ctx, { showKindNamespaceNotes });
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // Check for empty loadouts
  const totalOutputs = plans.reduce((sum, p) => sum + p.plan.outputs.length, 0);
  if (totalOutputs === 0) {
    log.warn("No outputs to apply. Loadouts may be empty.");
    return { applied: false, totalOutputs: 0 };
  }

  if (dryRun) {
    heading(`Would apply loadouts: ${targets.join(", ")} (${ctx.scope})`);

    // Collect all tools and build output list with "added" change type
    const toolSet = new Set<Tool>();
    const outputs: Array<{
      spec: (typeof plans)[0]["plan"]["outputs"][0]["spec"];
      change: ChangeType;
    }> = [];

    for (const { plan } of plans) {
      for (const { spec } of plan.outputs) {
        toolSet.add(spec.tool);
        outputs.push({ spec, change: "added" });
      }
    }

    const tools = Array.from(toolSet).sort();
    const artifacts = groupOutputsByArtifact(outputs);
    renderChangeTable(artifacts, tools, { showMode: true });
    renderDryRunSummary(totalOutputs, tools.length);

    const allShadowed = plans.flatMap((p) => p.plan.shadowed);
    if (allShadowed.length > 0) {
      console.log();
      log.warn(`${allShadowed.length} outputs would be shadowed by unmanaged files:`);
      for (const s of allShadowed) {
        log.dim(`  ${s.targetPath}  (${s.tool})`);
      }
    }

    return { applied: false, totalOutputs };
  }

  // Apply for real
  const rootConfig = parseRootConfig(ctx.configPath);
  const result = await applyMultiPlan(
    plans,
    ctx.configPath,
    ctx.projectRoot,
    rootConfig.mode,
    ctx.scope
  );

  heading(`${verb} loadouts: ${targets.join(", ")} (${ctx.scope})`);

  // Build change-tagged outputs for table display
  const addedSet = new Set(result.changes.added);
  const updatedSet = new Set(result.changes.updated);
  const toolSet = new Set<Tool>();

  const outputs: Array<{
    spec: (typeof plans)[0]["plan"]["outputs"][0]["spec"];
    change: ChangeType;
  }> = [];

  for (const { plan } of plans) {
    for (const { spec } of plan.outputs) {
      toolSet.add(spec.tool);
      let change: ChangeType = "unchanged";
      if (addedSet.has(spec.targetPath)) change = "added";
      else if (updatedSet.has(spec.targetPath)) change = "updated";
      outputs.push({ spec, change });
    }
  }

  // Add removed entries (they won't be in current plans)
  // We can't show these in the table since we don't have their specs anymore,
  // but we include them in the summary

  const tools = Array.from(toolSet).sort();
  const artifacts = groupOutputsByArtifact(outputs);

  // Only show table if there are changes
  const totalChanges =
    result.changes.updated.length +
    result.changes.added.length +
    result.changes.removed.length;

  if (totalChanges > 0 || artifacts.length > 0) {
    renderChangeTable(artifacts, tools);
  }

  renderChangeSummary(
    result.changes.added.length,
    result.changes.updated.length,
    result.changes.removed.length
  );

  const allShadowed = plans.flatMap((p) => p.plan.shadowed);
  if (allShadowed.length > 0) {
    console.log();
    log.warn(`${allShadowed.length} outputs shadowed by unmanaged files:`);
    for (const s of allShadowed) {
      log.dim(`  ${s.targetPath}  (${s.tool})`);
    }
    log.dim(
      "These files take precedence over the loadout. Use 'loadouts status' to review."
    );
  }

  return { applied: true, totalOutputs: result.totalOutputs };
}
