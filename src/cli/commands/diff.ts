/**
 * loadout diff — Show what would change if a loadout were applied.
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → show diff for both scopes
 *   (none)         → auto-detect; error if name exists in both without flag
 *
 * Output follows unified visual language (see docs/visual-language.md).
 */

import { Command } from "commander";
import { getContext } from "../../core/discovery.js";
import { loadResolvedLoadout } from "../../core/resolve.js";
import { planRender } from "../../core/render.js";
import { loadState } from "../../core/manifest.js";
import {
  resolveContexts,
  requireScopeForName,
  SCOPE_FLAGS,
  type ScopeFlags,
} from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import {
  groupOutputsByArtifact,
  renderChangeTable,
  type ChangeType,
} from "../../lib/artifact-table.js";
import type { CommandContext, Tool } from "../../core/types.js";

interface DiffOptions extends ScopeFlags {
  json?: boolean;
}

type DiffOutputEntry = {
  spec: {
    tool: string;
    kind: string;
    sourcePath: string;
    targetPath: string;
    mode: "symlink" | "copy" | "generate";
  };
  change: ChangeType;
};

export interface DiffJsonOutput {
  changes: Array<{
    tool: string;
    path: string;
    op: "create" | "overwrite" | "remove" | "shadowed";
  }>;
}

const JSON_OP_MAP: Record<ChangeType, DiffJsonOutput["changes"][number]["op"]> = {
  added: "create",
  updated: "overwrite",
  unchanged: "overwrite",
  removed: "remove",
  shadowed: "shadowed",
};

async function buildDiffOutputs(ctx: CommandContext, name?: string): Promise<DiffOutputEntry[]> {
  const result = await loadResolvedLoadout(ctx, name);
  const { loadout } = result;

  const plan = await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath);
  const state = loadState(ctx.configPath);

  const stateTargets = new Set(state?.entries.map((entry) => entry.targetPath) || []);
  const planTargets = new Set(plan.outputs.map((output) => output.spec.targetPath));

  const outputs: DiffOutputEntry[] = [];

  for (const { spec } of plan.outputs) {
    const change: ChangeType = stateTargets.has(spec.targetPath) ? "updated" : "added";
    outputs.push({ spec, change });
  }

  if (state) {
    for (const entry of state.entries) {
      if (!planTargets.has(entry.targetPath)) {
        outputs.push({
          spec: {
            tool: entry.tools[0],
            kind: entry.kind,
            sourcePath: entry.sourcePath,
            targetPath: entry.targetPath,
            mode: entry.mode,
          },
          change: "removed",
        });
      }
    }
  }

  for (const entry of plan.shadowed) {
    outputs.push({
      spec: {
        tool: entry.tool,
        kind: entry.kind,
        sourcePath: entry.sourcePath,
        targetPath: entry.targetPath,
        mode: "symlink",
      },
      change: "shadowed",
    });
  }

  return outputs;
}

export async function getDiffJsonForContext(ctx: CommandContext, name?: string): Promise<DiffJsonOutput> {
  const outputs = await buildDiffOutputs(ctx, name);
  return {
    changes: outputs.map((output) => ({
      tool: output.spec.tool,
      path: output.spec.targetPath,
      op: JSON_OP_MAP[output.change],
    })),
  };
}

export async function getDiffJson(
  name: string | undefined,
  options: ScopeFlags,
  cwd: string = process.cwd()
): Promise<DiffJsonOutput> {
  if (name && !options.local && !options.global && !options.all) {
    const scope = await requireScopeForName(name, options, cwd);
    const ctx = await getContext(scope, cwd);
    return getDiffJsonForContext(ctx, name);
  }

  const { contexts } = await resolveContexts(options, cwd);
  const changes: DiffJsonOutput["changes"] = [];

  for (const ctx of contexts) {
    try {
      const payload = await getDiffJsonForContext(ctx, name);
      changes.push(...payload.changes);
    } catch {
      // Scope doesn't have this loadout.
    }
  }

  return { changes };
}

export async function executeDiff(
  ctx: CommandContext,
  name?: string
): Promise<void> {
  const result = await loadResolvedLoadout(ctx, name);
  const { loadoutName } = result;
  const outputs = await buildDiffOutputs(ctx, name);

  heading(`Diff: ${loadoutName} (${ctx.scope})`);

  // Collect all tools
  const toolSet = new Set<Tool>();
  for (const { spec } of outputs) {
    toolSet.add(spec.tool);
  }
  const tools = Array.from(toolSet).sort();

  if (outputs.length === 0) {
    log.success("No changes");
    return;
  }

  const artifacts = groupOutputsByArtifact(outputs);
  renderChangeTable(artifacts, tools, { showAction: true });

  // Summary counts
  const added = outputs.filter((o) => o.change === "added").length;
  const updated = outputs.filter((o) => o.change === "updated").length;
  const removed = outputs.filter((o) => o.change === "removed").length;
  const shadowed = outputs.filter((o) => o.change === "shadowed").length;

  console.log();
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} to create`);
  if (updated > 0) parts.push(`${updated} to update`);
  if (removed > 0) parts.push(`${removed} to remove`);
  if (shadowed > 0) parts.push(`${shadowed} shadowed`);
  log.dim(`  ${parts.join(" • ")}`);
}

export const diffCommand = new Command("diff")
  .alias("df")
  .description("Show what would change if loadout were applied")
  .argument("[name]", "Loadout name (uses default if not specified)")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--json", "Output machine-readable JSON")
  .action(async (name: string | undefined, options: DiffOptions) => {
    const cwd = process.cwd();

    if (options.json) {
      try {
        const payload = await getDiffJson(name, options, cwd);
        console.log(JSON.stringify(payload, null, 2));
      } catch (err) {
        log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      return;
    }

    // If a name is given and no explicit scope, check for collisions
    if (name && !options.local && !options.global && !options.all) {
      try {
        const scope = await requireScopeForName(name, options, cwd);
        const ctx = await getContext(scope, cwd);
        await executeDiff(ctx, name);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("exists in both")) {
          log.error(msg);
          process.exit(1);
        }
      }
    }

    // Show diff for all resolved scopes
    const { contexts } = await resolveContexts(options, cwd);
    let hasAny = false;

    for (const ctx of contexts) {
      try {
        await executeDiff(ctx, name);
        hasAny = true;
      } catch {
        // Scope doesn't have this loadout — skip silently
      }
    }

    if (!hasAny) {
      log.warn("No loadout found.");
      log.dim("Run 'loadouts init' to set up a loadout.");
    }
  });
