/**
 * loadout info — Show detailed loadout information.
 *
 * Displays a unified table of all active loadouts with artifacts grouped by
 * loadout name. Scope is indicated subtly with symbols:
 *   • global (dim)
 *   ◦ local (cyan)
 *   ◆ bundled (blue)
 *   →name source (yellow)
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → show both scopes (default)
 *   (none)         → all available scopes; error if name exists in both without flag
 */

import { Command } from "commander";
import chalk from "chalk";
import {
  resolveContexts,
  requireScopeForName,
  SCOPE_FLAGS,
  type ScopeFlags,
} from "../../core/scope.js";
import { getContext, findLoadoutInCatalog } from "../../core/discovery.js";
import { loadResolvedLoadout, resolveLoadout } from "../../core/resolve.js";
import { loadState } from "../../core/manifest.js";
import { log, heading } from "../../lib/output.js";
import {
  getArtifactName,
  sortArtifacts,
  truncatePath,
  getToolColumns,
  calculateColumnWidths,
} from "../../lib/artifact-table.js";
import {
  type ScopeIndicator,
  getScopeFromRoots,
  renderScopeLegend,
} from "../../lib/scope-indicators.js";
import {
  calculateLoadoutColumnWidths,
  renderLoadoutHeader,
  renderLoadoutSeparator,
  renderLoadoutCell,
} from "../../lib/loadout-column.js";
import type { CommandContext, ResolvedItem, Tool, LoadoutRoot } from "../../core/types.js";
import { registry } from "../../core/registry.js";
import { parseRootConfig } from "../../core/config.js";
import {
  estimateFileTokens,
  estimateDirTokens,
  estimateSkillUpfrontTokens,
  formatTokens,
} from "../../core/tokens.js";

// Kinds whose content goes into the agent's context window.
// Extensions (runtime code) and themes (UI config) don't count.
const CONTEXT_KINDS = new Set(["rule", "skill", "instruction", "prompt"]);

/**
 * Token breakdown for a resolved item.
 * - upfront: tokens injected into context at session start
 * - lazy: tokens loaded on-demand when the artifact is invoked
 */
interface TokenBreakdown {
  upfront: number;
  lazy: number;
}

/**
 * Estimate tokens for a resolved item based on its kind.
 * Skills are special: only the description is upfront, full content is lazy.
 */
function getItemTokens(item: ResolvedItem): TokenBreakdown {
  if (!CONTEXT_KINDS.has(item.kind)) return { upfront: 0, lazy: 0 };
  const kind = registry.getKind(item.kind);
  if (!kind) return { upfront: 0, lazy: 0 };

  // Skills: description is upfront, full content is lazy-loaded
  if (item.kind === "skill") {
    const upfront = estimateSkillUpfrontTokens(item.sourcePath);
    const total = estimateDirTokens(item.sourcePath);
    return { upfront, lazy: Math.max(0, total - upfront) };
  }

  // All other context kinds: full content is upfront
  const total = kind.layout === "dir"
    ? estimateDirTokens(item.sourcePath)
    : estimateFileTokens(item.sourcePath);
  return { upfront: total, lazy: 0 };
}

/**
 * Artifact row with computed display name and tokens.
 */
interface ArtifactInfo {
  kind: string;
  name: string;
  relativePath: string;
  tools: Tool[];
  tokens: TokenBreakdown;
}

/**
 * A loadout group with its artifacts and scope indicator.
 */
interface LoadoutGroup {
  loadoutName: string;
  scope: ScopeIndicator;
  isActive: boolean;
  description?: string;
  rootPath: string;
  artifacts: ArtifactInfo[];
  tools: Tool[];
}

interface CatalogLoadoutGroupResult {
  group: LoadoutGroup;
  warnings: string[];
}

function renderCatalogLoadoutResult(name: string, result: CatalogLoadoutGroupResult): void {
  heading(`Loadout: ${name}`);
  renderUnifiedTable([result.group]);
  if (result.warnings.length > 0) {
    console.log();
    for (const warning of result.warnings) {
      log.warn(warning);
    }
  }
}

/**
 * Transform resolved items into artifact info for display.
 */
function toArtifactInfo(items: ResolvedItem[]): ArtifactInfo[] {
  return items.map((item) => ({
    kind: item.kind,
    name: getArtifactName(item.relativePath, item.kind),
    relativePath: item.relativePath,
    tools: item.tools,
    tokens: getItemTokens(item),
  }));
}

/**
 * Render the unified artifact table with loadout grouping.
 */
function renderUnifiedTable(groups: LoadoutGroup[]): void {
  if (groups.length === 0) {
    log.dim("  No artifacts.");
    console.log();
    return;
  }

  // Flatten all artifacts for column width calculation
  const allArtifacts: Array<ArtifactInfo & { loadoutName: string }> = [];
  for (const group of groups) {
    for (const artifact of group.artifacts) {
      allArtifacts.push({ ...artifact, loadoutName: group.loadoutName });
    }
  }

  if (allArtifacts.length === 0) {
    log.dim("  No artifacts.");
    console.log();
    return;
  }

  // Collect all tools across all groups
  const allToolsSet = new Set<Tool>();
  for (const group of groups) {
    for (const tool of group.tools) {
      allToolsSet.add(tool);
    }
  }
  const allTools = Array.from(allToolsSet).sort();

  // Pre-compute token totals
  let totalUpfront = 0;
  let totalLazy = 0;
  for (const artifact of allArtifacts) {
    totalUpfront += artifact.tokens.upfront;
    totalLazy += artifact.tokens.lazy;
  }

  // Check if any items have tokens to show
  const hasTokens = totalUpfront > 0 || totalLazy > 0;
  const hasLazy = totalLazy > 0;

  // Calculate column widths
  const { nameWidth: loadoutNameWidth, scopeWidth, totalWidth: loadoutColWidth } = 
    calculateLoadoutColumnWidths(groups);
  
  const { kindWidth, nameWidth } = calculateColumnWidths(allArtifacts);
  const toolCols = getToolColumns(allTools);

  // Token column widths (right-aligned numbers)
  const TOKEN_W = hasTokens ? 7 : 0;
  const LAZY_W = hasLazy ? 7 : 0;

  // ── Header ───────────────────────────────────────────────────────────────
  const loadoutH = renderLoadoutHeader(loadoutColWidth);
  const kindH = chalk.dim("kind".padEnd(kindWidth));
  const nameH = chalk.dim("artifact".padEnd(nameWidth));
  const upfrontH = hasTokens ? chalk.dim("upfront".padStart(TOKEN_W)) + "  " : "";
  const lazyH = hasLazy ? chalk.dim("lazy".padStart(LAZY_W)) + "  " : "";
  const toolH = toolCols.map((c) => chalk.dim(c.tool)).join("  ");
  console.log(`  ${loadoutH}  ${kindH}  ${nameH}  ${upfrontH}${lazyH}${toolH}`);

  // ── Separator ─────────────────────────────────────────────────────────────
  const sepParts = [
    renderLoadoutSeparator(loadoutColWidth),
    "─".repeat(kindWidth),
    "─".repeat(nameWidth),
    ...(hasTokens ? ["─".repeat(TOKEN_W)] : []),
    ...(hasLazy ? ["─".repeat(LAZY_W)] : []),
    toolCols.map((c) => "─".repeat(c.width)).join("  "),
  ];
  console.log(chalk.dim(`  ${sepParts.join("  ")}`));

  // ── Rows (grouped by loadout) ─────────────────────────────────────────────
  for (const group of groups) {
    const sortedArtifacts = sortArtifacts(group.artifacts);

    for (let i = 0; i < sortedArtifacts.length; i++) {
      const artifact = sortedArtifacts[i];
      const isFirstInGroup = i === 0;

      // Loadout cell (only show on first row of group)
      const loadoutCell = renderLoadoutCell(
        isFirstInGroup ? group : null,
        loadoutNameWidth,
        scopeWidth,
        loadoutColWidth
      );

      const kindCell = chalk.dim(artifact.kind.padEnd(kindWidth));
      const nameCell = truncatePath(artifact.name, nameWidth).padEnd(nameWidth);

      // Token cells (upfront and lazy)
      let upfrontCell = "";
      let lazyCell = "";
      if (hasTokens) {
        if (artifact.tokens.upfront > 0) {
          const formatted = artifact.tokens.upfront >= 1000
            ? `${(artifact.tokens.upfront / 1000).toFixed(1)}k`
            : String(artifact.tokens.upfront);
          upfrontCell = chalk.cyan(formatted.padStart(TOKEN_W)) + "  ";
        } else {
          upfrontCell = chalk.dim("—".padStart(TOKEN_W)) + "  ";
        }
      }
      if (hasLazy) {
        if (artifact.tokens.lazy > 0) {
          const formatted = artifact.tokens.lazy >= 1000
            ? `${(artifact.tokens.lazy / 1000).toFixed(1)}k`
            : String(artifact.tokens.lazy);
          lazyCell = chalk.yellow(formatted.padStart(LAZY_W)) + "  ";
        } else {
          lazyCell = chalk.dim("—".padStart(LAZY_W)) + "  ";
        }
      }

      // Tool cells
      // Tool cells - right-justified within each column
      const toolCells = toolCols
        .map((c) => {
          const hasMapping = registry.resolveMapping(c.tool, artifact.kind);
          if (artifact.tools.includes(c.tool) && hasMapping) {
            return " ".repeat(c.width - 1) + chalk.green("✓");
          }
          return " ".repeat(c.width);
        })
        .join("  ");

      console.log(`  ${loadoutCell}  ${kindCell}  ${nameCell}  ${upfrontCell}${lazyCell}${toolCells}`);
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  console.log();

  // Token summary
  if (hasTokens) {
    if (hasLazy) {
      log.dim(`  Upfront: ${formatTokens(totalUpfront)} • Lazy: ${formatTokens(totalLazy)} • Total: ${formatTokens(totalUpfront + totalLazy)}`);
    } else {
      log.dim(`  Total context: ${formatTokens(totalUpfront)}`);
    }
  }

  // Scope legend
  renderScopeLegend(groups);

  console.log();
}

/**
 * Load a single loadout and create a LoadoutGroup.
 */
async function loadLoadoutGroup(
  ctx: CommandContext,
  name: string,
  isActive: boolean
): Promise<LoadoutGroup> {
  const { loadout, roots } = await loadResolvedLoadout(ctx, name, { includeBundled: true });
  const scope = getScopeFromRoots(loadout.rootPath, roots, ctx.scope);

  return {
    loadoutName: name,
    scope,
    isActive,
    description: loadout.description,
    rootPath: loadout.rootPath,
    artifacts: toArtifactInfo(loadout.items),
    tools: loadout.tools,
  };
}

/**
 * Load a single loadout directly from catalog roots (project/global/bundled).
 */
async function loadCatalogLoadoutGroup(
  name: string,
  cwd: string
): Promise<CatalogLoadoutGroupResult | null> {
  const catalogResult = await findLoadoutInCatalog(name, cwd);
  if (!catalogResult) return null;

  const { entry, entries, warnings } = catalogResult;

  const roots = entries.map((entry) => entry.root);
  const rootConfig = parseRootConfig(entry.root.path);
  const loadout = resolveLoadout(name, roots, rootConfig);

  const owner = entries.find((entry) => entry.root.path === loadout.rootPath)?.owner;

  const projectPrimary = entries.find(
    (entry) => entry.owner === "project" && entry.root.level === "project"
  );
  const globalPrimary = entries.find(
    (entry) => entry.owner === "global" && entry.root.level === "global"
  );

  const activeInProject = projectPrimary
    ? new Set(loadState(projectPrimary.root.path)?.active || []).has(name)
    : false;
  const activeInGlobal = globalPrimary
    ? new Set(loadState(globalPrimary.root.path)?.active || []).has(name)
    : false;

  const isActive = owner === "project" ? activeInProject : owner === "global" ? activeInGlobal : false;
  const fallbackScope = owner === "project" ? "project" : "global";

  return {
    group: {
      loadoutName: name,
      scope: getScopeFromRoots(loadout.rootPath, roots, fallbackScope),
      isActive,
      description: loadout.description,
      rootPath: loadout.rootPath,
      artifacts: toArtifactInfo(loadout.items),
      tools: loadout.tools,
    },
    warnings,
  };
}

/**
 * Collect all active loadouts from a context.
 * Returns empty array if no state or no active loadouts.
 */
async function collectActiveGroups(ctx: CommandContext): Promise<LoadoutGroup[]> {
  const state = loadState(ctx.configPath);
  if (!state || state.active.length === 0) {
    return [];
  }

  const groups: LoadoutGroup[] = [];
  for (const activeName of state.active) {
    try {
      const group = await loadLoadoutGroup(ctx, activeName, true);
      groups.push(group);
    } catch {
      // Skip loadouts that can't be loaded (deleted, broken, etc.)
    }
  }
  return groups;
}

/**
 * Check if a loadout is active in a context.
 */
function isLoadoutActive(ctx: CommandContext, name: string): boolean {
  const state = loadState(ctx.configPath);
  return state?.active.includes(name) ?? false;
}

/**
 * Execute info command - unified view of all active loadouts.
 */
export async function executeInfo(
  contexts: CommandContext[],
  explicitName?: string
): Promise<boolean> {
  const groups: LoadoutGroup[] = [];

  if (explicitName) {
    // Explicit name: show that loadout from whichever context has it
    for (const ctx of contexts) {
      try {
        const isActive = isLoadoutActive(ctx, explicitName);
        const group = await loadLoadoutGroup(ctx, explicitName, isActive);
        groups.push(group);
      } catch {
        // Loadout doesn't exist in this context, skip
      }
    }
  } else {
    // No name: show all active loadouts from all contexts
    for (const ctx of contexts) {
      const contextGroups = await collectActiveGroups(ctx);
      groups.push(...contextGroups);
    }
  }

  if (groups.length === 0) {
    return false;
  }

  // Choose heading based on whether we're showing a specific loadout or active ones
  const title = explicitName ? `Loadout: ${explicitName}` : "Active loadouts";
  heading(title);
  renderUnifiedTable(groups);
  return true;
}

export const infoCommand = new Command("info")
  .alias("i")
  .description("Show loadout information")
  .argument("[name]", "Loadout name (uses active loadouts if not specified)")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .action(async (name: string | undefined, options: ScopeFlags) => {
    const cwd = process.cwd();

    const canUseCatalogFallback = Boolean(name && !options.local && !options.global);

    // If a name is given and no explicit scope, check for collisions
    if (name && !options.local && !options.global && !options.all) {
      try {
        const scope = await requireScopeForName(name, options, cwd);
        const ctx = await getContext(scope, cwd);
        const hasAny = await executeInfo([ctx], name);
        if (!hasAny) {
          log.error(`Loadout not found: ${name}`);
          process.exit(1);
        }
        return;
      } catch (err) {
        // If it's a writable-scope collision, surface it directly.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("exists in both")) {
          log.error(msg);
          process.exit(1);
        }
        // Otherwise fall through to catalog fallback.
      }

      const catalogResult = await loadCatalogLoadoutGroup(name, cwd);
      if (catalogResult) {
        renderCatalogLoadoutResult(name, catalogResult);
        return;
      }

      log.error(`Loadout not found: ${name}`);
      process.exit(1);
    }

    // Show info for all resolved writable scopes
    let contexts: CommandContext[];
    try {
      ({ contexts } = await resolveContexts(options, cwd));
    } catch (err) {
      if (canUseCatalogFallback) {
        const catalogResult = await loadCatalogLoadoutGroup(name!, cwd);
        if (catalogResult) {
          renderCatalogLoadoutResult(name!, catalogResult);
          return;
        }
      }

      const msg = err instanceof Error ? err.message : String(err);
      log.error(msg);
      process.exit(1);
    }

    const hasAny = await executeInfo(contexts, name);

    if (!hasAny && canUseCatalogFallback) {
      const catalogResult = await loadCatalogLoadoutGroup(name!, cwd);
      if (catalogResult) {
        renderCatalogLoadoutResult(name!, catalogResult);
        return;
      }
    }

    if (!hasAny) {
      if (name) {
        log.error(`Loadout not found: ${name}`);
      } else {
        log.warn("No loadout applied.");
        log.dim("Run 'loadout info <name>' to inspect a loadout without activating.");
      }
    }
  });
