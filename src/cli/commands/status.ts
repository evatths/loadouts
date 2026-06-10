/**
 * loadout status — Show drift status for active loadouts.
 *
 * Displays a unified table of all active loadouts with drift status.
 * Uses the same visual language as `info` and `list`:
 *   • (dim)    — global scope
 *   ◦ (cyan)   — local/project scope
 *   →name (yellow) — external source
 *
 * Detects two types of drift:
 *   1. Config drift: loadout definition changed (items added/removed)
 *   2. Output drift: managed files changed on disk (modified/missing/unlinked)
 *
 * Scope flags:
 *   -l / --local   → project scope only
 *   -g / --global  → global scope only
 *   -a / --all     → show both scopes (default)
 */

import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import { loadState, detectDrift, type DriftResult } from "../../core/manifest.js";
import { loadResolvedLoadout } from "../../core/resolve.js";
import { planRender } from "../../core/render.js";
import { findUnsanitizedRules, findUnsanitizedSkills } from "../../core/config.js";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import {
  getArtifactName,
  truncatePath,
  getToolColumns,
  calculateColumnWidths,
  KIND_SORT_ORDER,
} from "../../lib/artifact-table.js";
import { extractRelativePath } from "../../lib/artifact-paths.js";
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
import type { CommandContext, AppliedState, Tool, LoadoutRoot, ResolvedLoadout } from "../../core/types.js";
import type { RenderPlan } from "../../core/types.js";

type DriftStatus = DriftResult["status"];

// Status priority for determining "worst" status (higher = worse)
const STATUS_PRIORITY: Record<DriftStatus, number> = {
  ok: 0,
  modified: 1,
  unlinked: 2,
  misdirected: 3,
  missing: 4,
  broken: 5,
};

// Status display symbols and colors
const STATUS_DISPLAY: Record<DriftStatus, { symbol: string; color: (s: string) => string }> = {
  ok: { symbol: "✓", color: chalk.green },
  modified: { symbol: "~", color: chalk.yellow },
  unlinked: { symbol: "⚡", color: chalk.yellow },
  misdirected: { symbol: "→", color: chalk.red },
  missing: { symbol: "!", color: chalk.red },
  broken: { symbol: "💀", color: chalk.red },
};

interface ConfigDrift {
  added: string[];   // targets to be created
  removed: string[]; // targets to be deleted (orphaned)
}

// Artifact with drift status
interface ArtifactStatus {
  name: string;
  relativePath: string;
  kind: string;
  toolStatus: Map<Tool, DriftStatus>;
  overallStatus: DriftStatus;
}

// A loadout group with its artifacts and drift info
interface LoadoutStatusGroup {
  loadoutName: string;
  scope: ScopeIndicator;
  isActive: boolean;
  appliedAt: string;
  mode: string;
  artifacts: ArtifactStatus[];
  tools: Tool[];
  config: ConfigDrift;
  shadowed: Array<{ targetPath: string; tools: string[] }>;
  inSync: boolean;
}

/**
 * Detect config drift by comparing current loadout definition against applied state.
 */
function detectConfigDrift(plan: RenderPlan, state: AppliedState): ConfigDrift {
  const stateTargets = new Set(state.entries.map((e) => e.targetPath));
  const planTargets = new Set(plan.outputs.map((o) => o.spec.targetPath));

  const added = plan.outputs
    .filter((o) => !stateTargets.has(o.spec.targetPath))
    .map((o) => o.spec.targetPath);

  const removed = state.entries
    .filter((e) => !planTargets.has(e.targetPath))
    .map((e) => e.targetPath);

  return { added, removed };
}

/**
 * Convert sourcePath to a display-friendly relative path.
 */
function getRelativePath(sourcePath: string, configPath: string, projectRoot: string): string {
  // Try the consolidated helper first (handles bundled, .loadout, etc.)
  const extracted = extractRelativePath(sourcePath);
  // If it extracted something meaningful (not just parent/basename fallback)
  if (!extracted.includes(path.sep) || extracted.startsWith("skills/") || 
      extracted.startsWith("rules/") || extracted.startsWith("instructions/") ||
      extracted.startsWith("extensions/")) {
    return extracted;
  }

  // Fallback to relative path calculation
  const relConfig = path.relative(configPath, sourcePath);
  if (!relConfig.startsWith("..")) return relConfig;

  const relProject = path.relative(projectRoot, sourcePath);
  if (!relProject.startsWith("..")) return relProject;

  return extracted;
}

/**
 * Group drift results by artifact (sourcePath) and compute per-tool status.
 */
function groupByArtifact(
  driftResults: DriftResult[],
  configPath: string,
  projectRoot: string
): { artifacts: ArtifactStatus[]; tools: Tool[] } {
  const toolSet = new Set<Tool>();
  for (const result of driftResults) {
    for (const tool of result.entry.tools) {
      toolSet.add(tool);
    }
  }
  const tools = Array.from(toolSet).sort();

  const bySource = new Map<string, DriftResult[]>();
  for (const result of driftResults) {
    const key = result.entry.sourcePath;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(result);
  }

  const artifacts: ArtifactStatus[] = [];
  for (const [sourcePath, results] of bySource) {
    const toolStatus = new Map<Tool, DriftStatus>();
    let worstPriority = 0;
    let overallStatus: DriftStatus = "ok";

    for (const result of results) {
      for (const tool of result.entry.tools) {
        toolStatus.set(tool, result.status);
      }
      const priority = STATUS_PRIORITY[result.status];
      if (priority > worstPriority) {
        worstPriority = priority;
        overallStatus = result.status;
      }
    }

    const relativePath = getRelativePath(sourcePath, configPath, projectRoot);
    const kind = results[0].entry.kind;

    artifacts.push({
      name: getArtifactName(relativePath, kind),
      relativePath,
      kind,
      toolStatus,
      overallStatus,
    });
  }

  return { artifacts, tools };
}

/**
 * Sort artifacts: worst status first, then by kind priority, then by name.
 */
function sortByStatusThenKind(artifacts: ArtifactStatus[]): ArtifactStatus[] {
  return [...artifacts].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.overallStatus];
    const pb = STATUS_PRIORITY[b.overallStatus];
    if (pa !== pb) return pb - pa;

    const orderA = KIND_SORT_ORDER[a.kind] ?? 100;
    const orderB = KIND_SORT_ORDER[b.kind] ?? 100;
    if (orderA !== orderB) return orderA - orderB;

    return a.name.localeCompare(b.name);
  });
}

/**
 * Collapse skill reference files into their parent skill.
 */
function collapseSkillReferences(artifacts: ArtifactStatus[]): ArtifactStatus[] {
  const skillGroups = new Map<string, ArtifactStatus[]>();
  const nonSkills: ArtifactStatus[] = [];

  for (const artifact of artifacts) {
    if (artifact.kind !== "skill") {
      nonSkills.push(artifact);
      continue;
    }

    const match = artifact.relativePath.match(/^skills\/([^/]+)/);
    if (!match) {
      nonSkills.push(artifact);
      continue;
    }

    const skillName = match[1];
    if (!skillGroups.has(skillName)) skillGroups.set(skillName, []);
    skillGroups.get(skillName)!.push(artifact);
  }

  const collapsedSkills: ArtifactStatus[] = [];
  for (const [skillName, files] of skillGroups) {
    const mergedToolStatus = new Map<Tool, DriftStatus>();
    let worstPriority = 0;
    let overallStatus: DriftStatus = "ok";

    for (const file of files) {
      for (const [tool, status] of file.toolStatus) {
        const existing = mergedToolStatus.get(tool);
        if (!existing || STATUS_PRIORITY[status] > STATUS_PRIORITY[existing]) {
          mergedToolStatus.set(tool, status);
        }
      }
      const priority = STATUS_PRIORITY[file.overallStatus];
      if (priority > worstPriority) {
        worstPriority = priority;
        overallStatus = file.overallStatus;
      }
    }

    collapsedSkills.push({
      name: skillName,
      relativePath: `skills/${skillName}`,
      kind: "skill",
      toolStatus: mergedToolStatus,
      overallStatus,
    });
  }

  return [...nonSkills, ...collapsedSkills];
}

/**
 * Load status group for a single loadout within a context.
 */
async function loadStatusGroupForLoadout(
  ctx: CommandContext,
  loadoutName: string,
  state: AppliedState,
  showReferences: boolean
): Promise<LoadoutStatusGroup | null> {
  // Resolve the loadout to get its items
  let loadout: ResolvedLoadout;
  let roots: LoadoutRoot[] = [];
  let scope: ScopeIndicator = ctx.scope === "global" ? { type: "global" } : { type: "local" };

  try {
    const result = await loadResolvedLoadout(ctx, loadoutName, { includeBundled: true });
    loadout = result.loadout;
    roots = result.roots;
    scope = getScopeFromRoots(loadout.rootPath, roots, ctx.scope);
  } catch {
    // Loadout can't be resolved (deleted, broken, etc.) - skip
    return null;
  }

  // Plan what this loadout would render
  const plan = await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath);

  // Build a set of source paths this loadout owns
  const loadoutSourcePaths = new Set<string>();
  for (const output of plan.outputs) {
    loadoutSourcePaths.add(output.spec.sourcePath);
  }

  // Filter drift results to only include entries from this loadout
  const allDriftResults = detectDrift(state, ctx.projectRoot);
  const loadoutDriftResults = allDriftResults.filter((r) =>
    loadoutSourcePaths.has(r.entry.sourcePath)
  );

  const { artifacts, tools } = groupByArtifact(
    loadoutDriftResults,
    ctx.configPath,
    ctx.projectRoot
  );

  // Process artifacts
  let displayArtifacts: ArtifactStatus[];
  if (showReferences) {
    displayArtifacts = artifacts.map((a) => ({ ...a, name: a.relativePath }));
  } else {
    displayArtifacts = collapseSkillReferences(artifacts);
  }

  // Detect config drift for this loadout
  // Compare plan outputs to manifest entries with matching source paths
  const manifestTargetsForLoadout = new Set(
    state.entries
      .filter((e) => loadoutSourcePaths.has(e.sourcePath))
      .map((e) => e.targetPath)
  );
  const planTargets = new Set(plan.outputs.map((o) => o.spec.targetPath));

  const added = plan.outputs
    .filter((o) => !manifestTargetsForLoadout.has(o.spec.targetPath))
    .map((o) => o.spec.targetPath);
  const removed = state.entries
    .filter((e) => loadoutSourcePaths.has(e.sourcePath) && !planTargets.has(e.targetPath))
    .map((e) => e.targetPath);
  const config: ConfigDrift = { added, removed };

  // Process shadowed files for this loadout
  const loadoutShadowed = plan.shadowed.map((s) => ({
    targetPath: s.targetPath,
    tools: [s.tool],
  }));

  // Check sync status
  const configInSync = config.added.length === 0 && config.removed.length === 0;
  const outputInSync = displayArtifacts.every((a) => a.overallStatus === "ok");
  const inSync = configInSync && outputInSync;

  return {
    loadoutName,
    scope,
    isActive: true,
    appliedAt: state.appliedAt,
    mode: state.mode,
    artifacts: displayArtifacts,
    tools,
    config,
    shadowed: loadoutShadowed,
    inSync,
  };
}

/**
 * Load all status groups for a context (one per active loadout).
 */
async function loadStatusGroupsForContext(
  ctx: CommandContext,
  showReferences: boolean
): Promise<LoadoutStatusGroup[]> {
  const state = loadState(ctx.configPath);
  if (!state || state.active.length === 0) return [];

  const groups: LoadoutStatusGroup[] = [];
  for (const loadoutName of state.active) {
    const group = await loadStatusGroupForLoadout(ctx, loadoutName, state, showReferences);
    if (group && group.artifacts.length > 0) {
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Render the unified status table.
 */
function renderUnifiedStatusTable(groups: LoadoutStatusGroup[]): void {
  if (groups.length === 0) {
    log.dim("  No artifacts.");
    console.log();
    return;
  }

  // Flatten all artifacts for column width calculation
  const allArtifacts: Array<ArtifactStatus & { loadoutName: string }> = [];
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

  // Calculate column widths
  const { nameWidth: loadoutNameWidth, scopeWidth, totalWidth: loadoutColWidth } = 
    calculateLoadoutColumnWidths(groups);

  const { kindWidth, nameWidth } = calculateColumnWidths(allArtifacts);
  const toolCols = getToolColumns(allTools);
  const STATUS_W = 8;

  // ── Header ───────────────────────────────────────────────────────────────
  const loadoutH = renderLoadoutHeader(loadoutColWidth);
  const kindH = chalk.dim("kind".padEnd(kindWidth));
  const nameH = chalk.dim("artifact".padEnd(nameWidth));
  const toolH = toolCols.map((c) => chalk.dim(c.tool)).join("  ");
  const statusH = chalk.dim("status");
  console.log(`  ${loadoutH}  ${kindH}  ${nameH}  ${toolH}  ${statusH}`);

  // ── Separator ─────────────────────────────────────────────────────────────
  const sepParts = [
    renderLoadoutSeparator(loadoutColWidth),
    "─".repeat(kindWidth),
    "─".repeat(nameWidth),
    toolCols.map((c) => "─".repeat(c.width)).join("  "),
    "─".repeat(STATUS_W),
  ];
  console.log(chalk.dim(`  ${sepParts.join("  ")}`));

  // ── Rows (grouped by loadout) ─────────────────────────────────────────────
  for (const group of groups) {
    const sortedArtifacts = sortByStatusThenKind(group.artifacts);

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

      // Tool status cells
      // Tool cells - right-justified within each column
      const toolCells = toolCols
        .map((c) => {
          const status = artifact.toolStatus.get(c.tool);
          if (!status) return " ".repeat(c.width);
          const { symbol, color } = STATUS_DISPLAY[status];
          const symbolWidth = symbol === "💀" ? 2 : 1;
          return " ".repeat(c.width - symbolWidth) + color(symbol);
        })
        .join("  ");

      // Overall status
      const { color: overallColor } = STATUS_DISPLAY[artifact.overallStatus];
      const statusCell = overallColor(artifact.overallStatus);

      console.log(`  ${loadoutCell}  ${kindCell}  ${nameCell}  ${toolCells}  ${statusCell}`);
    }
  }

  console.log();
}

/**
 * Render config drift summary.
 */
function renderConfigDriftSummary(groups: LoadoutStatusGroup[]): void {
  const totalAdded = groups.reduce((sum, g) => sum + g.config.added.length, 0);
  const totalRemoved = groups.reduce((sum, g) => sum + g.config.removed.length, 0);

  if (totalAdded > 0) {
    log.info(`${totalAdded} to add`);
  }
  if (totalRemoved > 0) {
    log.warn(`${totalRemoved} to remove`);
  }
}

/**
 * Render shadowed files summary.
 */
function renderShadowedSummary(groups: LoadoutStatusGroup[]): void {
  const allShadowed = groups.flatMap((g) => g.shadowed);
  if (allShadowed.length === 0) return;

  log.dim(`${allShadowed.length} shadowed (unmanaged files blocking outputs):`);
  for (const { targetPath, tools } of allShadowed.slice(0, 5)) {
    log.dim(`  ? ${targetPath} ${chalk.dim(`(${tools.join(", ")})`)}`);
  }
  if (allShadowed.length > 5) {
    log.dim(`  ... and ${allShadowed.length - 5} more`);
  }
  console.log();
}

/**
 * Check for non-canonical artifact frontmatter and warn.
 */
function checkNonCanonicalFrontmatter(ctx: CommandContext): void {
  const unsanitizedRules = findUnsanitizedRules(ctx.configPath);
  const unsanitizedSkills = findUnsanitizedSkills(ctx.configPath);
  const total = unsanitizedRules.length + unsanitizedSkills.length;
  if (total === 0) return;

  log.warn(`${total} artifact(s) have non-canonical frontmatter:`);
  for (const name of unsanitizedRules) {
    log.dim(`  rule: ${name}`);
  }
  for (const name of unsanitizedSkills) {
    log.dim(`  skill: ${name}`);
  }
  log.dim("Run 'loadouts sanitize' to fix.");
  console.log();
}

/**
 * Execute status command - unified view of all active loadouts.
 */
export async function executeStatus(
  contexts: CommandContext[],
  showReferences: boolean
): Promise<boolean> {
  const groups: LoadoutStatusGroup[] = [];

  for (const ctx of contexts) {
    // Check for non-canonical rule/skill frontmatter first
    checkNonCanonicalFrontmatter(ctx);

    const contextGroups = await loadStatusGroupsForContext(ctx, showReferences);
    groups.push(...contextGroups);
  }

  if (groups.length === 0) {
    return false;
  }

  heading("Loadout status");

  // Config drift summary (only if there's drift)
  renderConfigDriftSummary(groups);

  // Unified table
  renderUnifiedStatusTable(groups);

  // Shadowed files
  renderShadowedSummary(groups);

  // Scope legend
  renderScopeLegend(groups);

  // Overall sync status
  const allInSync = groups.every((g) => g.inSync);
  console.log();
  if (allInSync) {
    log.success("All in sync");
  } else {
    log.dim("Run 'loadouts sync' to reconcile.");
  }

  return true;
}

interface StatusOptions extends ScopeFlags {
  references?: boolean;
}

export const statusCommand = new Command("status")
  .alias("s")
  .description("Show loadout status and drift")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("-r, --references", "Show individual skill reference files")
  .action(async (options: StatusOptions) => {
    const { contexts } = await resolveContexts(options);
    const hasAny = await executeStatus(contexts, options.references ?? false);

    if (!hasAny) {
      log.warn("No loadout applied.");
      log.dim("Run 'loadouts activate <name>' to apply a loadout.");
    }
  });
