import { clearState, loadState } from "../../core/manifest.js";
import { applyMultiPlan, planRender, removeManaged } from "../../core/render.js";
import { loadResolvedLoadouts } from "../../core/resolve.js";
import { parseRootConfig } from "../../core/config.js";
import type { CommandContext, RenderPlan, ResolvedLoadout } from "../../core/types.js";
import type { HostContext } from "./host.js";
import { getContext } from "../../core/discovery.js";
import { compileSession } from "../../integrations/opencode/delta.js";
import type { Effect, Intent } from "./intent.js";

export interface ActionContext {
  cwd: string;
  session?: HostContext["session"];
}

export async function executeEffect(effect: Effect, ctx: ActionContext): Promise<Intent> {
  try {
    if (effect.t === "reload") return done(effect.t, true, "Reload requested");
    if (effect.t === "editFile") return done(effect.t, true, effect.path);
    if (effect.layer === "session") {
      if (!ctx.session) return done(effect.t, false, "Select a session first");
      if (effect.t === "plan") {
        const compiled = await compileSession(ctx.cwd, effect.targetSet, { scope: effect.scope });
        return done(effect.t, true, "Session delta", [...compiled.bundle.components.map((item) => `+ ${item.kind} ${item.relativePath}`), ...compiled.warnings.map((warning) => `! ${warning}`)]);
      }
      const result = effect.t === "clear" || effect.targetSet.length === 0
        ? await ctx.session.activator.unequip(ctx.session.id)
        : await ctx.session.activator.equip(ctx.session.id, effect.targetSet, { scope: effect.scope });
      return done(effect.t, true, ["Session equipment updated", ...result.warnings].join("; "));
    }

    const fs = await getContext(effect.layer, ctx.cwd);
    if (effect.t === "plan") return done(effect.t, true, "Diff ready", await planLines(fs, effect.targetSet));

    if (effect.t === "clear" || effect.targetSet.length === 0) {
      const { removed, warnings } = await removeManaged(fs.configPath, fs.projectRoot, fs.scope);
      clearState(fs.configPath);
      return done(effect.t, true, [`${removed.length} output(s) removed`, ...warnings].join("; "));
    }

    const plans = await resolvePlans(fs, effect.targetSet);
    const mode = parseRootConfig(fs.configPath).mode;
    const result = await applyMultiPlan(plans, fs.configPath, fs.projectRoot, mode, fs.scope);
    if (result.conflicts.length) {
      return done(
        effect.t,
        false,
        "AGENTS.md has local edits; edit the named source or run `loadouts sync --force`",
        result.conflicts.flatMap((c) => c.edits.map((e) => e.owner ? `! edited section: ${e.owner.loadout} (${e.owner.displayPath})` : "! edits outside loadouts sections")),
      );
    }
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
