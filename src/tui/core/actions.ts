import { clearState, loadState } from "../../core/manifest.js";
import { applyMultiPlan, planRender, removeManaged } from "../../core/render.js";
import { loadResolvedLoadouts } from "../../core/resolve.js";
import { parseRootConfig } from "../../core/config.js";
import type { CommandContext, RenderPlan, ResolvedLoadout } from "../../core/types.js";
import type { RuntimeInjector } from "./host.js";
import type { Effect, Intent } from "./intent.js";

export interface ActionContext {
  fs: CommandContext;
  runtime?: RuntimeInjector;
}

export async function executeEffect(effect: Effect, ctx: ActionContext): Promise<Intent> {
  try {
    if (effect.t === "reload") return done(effect.t, true, "Reload requested");
    if (effect.t === "editFile") return done(effect.t, true, effect.path);
    if (effect.t === "plan") return done(effect.t, true, "Diff ready", await planLines(ctx.fs, effect.targetSet));

    if (effect.mode === "runtime") {
      if (!ctx.runtime) return done(effect.t, false, "Runtime activation is unavailable");
      if (effect.t === "clear" || effect.targetSet.length === 0) await ctx.runtime.deactivate();
      else await ctx.runtime.activate(effect.targetSet, effect.scope === "project" ? "local" : "global");
      return done(effect.t, true, effect.t === "clear" ? "Runtime loadouts cleared" : "Runtime loadouts activated");
    }

    if (effect.t === "clear" || effect.targetSet.length === 0) {
      const { removed } = await removeManaged(ctx.fs.configPath, ctx.fs.projectRoot, ctx.fs.scope);
      clearState(ctx.fs.configPath);
      return done(effect.t, true, `${removed.length} output(s) removed`);
    }

    const plans = await resolvePlans(ctx.fs, effect.targetSet);
    const mode = parseRootConfig(ctx.fs.configPath).mode;
    const result = await applyMultiPlan(plans, ctx.fs.configPath, ctx.fs.projectRoot, mode, ctx.fs.scope);
    return done(effect.t, true, `${result.totalOutputs} output(s) applied`);
  } catch (err) {
    return done(effect.t, false, err instanceof Error ? err.message : String(err));
  }
}

async function resolvePlans(ctx: CommandContext, targets: string[]): Promise<Array<{ loadout: ResolvedLoadout; plan: RenderPlan }>> {
  const { loadouts } = await loadResolvedLoadouts(ctx, targets, { includeBundled: true });
  const plans = [];
  for (const loadout of loadouts) {
    const plan = await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath);
    if (plan.errors.length > 0) throw new Error(plan.errors.join("\n"));
    plans.push({ loadout, plan });
  }
  return plans;
}

async function planLines(ctx: CommandContext, targets: string[]): Promise<string[]> {
  if (targets.length === 0) return ["No active loadouts"];
  const plans = await resolvePlans(ctx, targets);
  const state = loadState(ctx.configPath);
  const stateTargets = new Set(state?.entries.map((entry) => entry.targetPath) ?? []);
  const planTargets = new Set(plans.flatMap(({ plan }) => plan.outputs.map((output) => output.spec.targetPath)));
  const lines: string[] = [];
  for (const { plan } of plans) {
    for (const output of plan.outputs) lines.push(`${stateTargets.has(output.spec.targetPath) ? "~" : "+"} ${output.spec.kind} ${output.spec.targetPath} (${output.spec.tool})`);
    for (const shadowed of plan.shadowed) lines.push(`! shadowed ${shadowed.targetPath} (${shadowed.tool})`);
  }
  for (const entry of state?.entries ?? []) {
    if (!planTargets.has(entry.targetPath)) lines.push(`- ${entry.kind} ${entry.targetPath} (${entry.tools.join(",")})`);
  }
  return lines.length ? lines : ["No changes"];
}

function done(effect: Effect["t"], ok: boolean, message: string, data?: string[]): Intent {
  return { t: "effectDone", effect, ok, message, data };
}
