/**
 * Shared artifact table rendering utilities.
 *
 * All commands that display artifact information should use these utilities
 * to maintain visual consistency. See docs/visual-language.md for the full spec.
 */

import chalk from "chalk";
import type { Tool, OutputMode } from "../core/types.js";
import { extractRelativePath } from "./artifact-paths.js";

// Sort order for artifact kinds in display
// Prioritizes context-heavy kinds first, then alphabetical for the rest
export const KIND_SORT_ORDER: Record<string, number> = {
  instruction: 0,
  rule: 1,
  skill: 2,
  agent: 3,
  prompt: 4,  // slash commands
  // Everything else gets 100, sorted alphabetically within that tier
};

/**
 * Base artifact info needed for table display.
 */
export interface ArtifactRow {
  kind: string;
  name: string;         // Display name (e.g., "codebase-layout")
  relativePath: string; // Full relative path for reference
  tools: Tool[];        // Tools this artifact applies to
}

/**
 * Extract artifact display name from a relative path.
 * 
 * Examples:
 *   skills/codebase-layout → codebase-layout
 *   skills/codebase-layout/SKILL.md → codebase-layout
 *   rules/agent-definitions.md → agent-definitions
 *   instructions/AGENTS.base.md → AGENTS.base.md
 */
export function getArtifactName(relativePath: string, kind: string): string {
  // For skills, extract the skill directory name
  if (kind === "skill") {
    const match = relativePath.match(/^skills\/([^/]+)/);
    if (match) return match[1];
  }

  // For rules, strip the rules/ prefix and .md extension
  if (kind === "rule") {
    const match = relativePath.match(/^rules\/(.+)\.md$/);
    if (match) return match[1];
  }

  // For agents, strip the agents/ prefix and .md extension
  if (kind === "agent") {
    const match = relativePath.match(/^agents\/(.+)\.md$/);
    if (match) return match[1];
  }

  // For instructions, extract AGENTS.<loadout>.md filename
  if (kind === "instruction") {
    // Handle instructions/AGENTS.<loadout>.md -> AGENTS.<loadout>.md
    const dirMatch = relativePath.match(/^instructions\/(AGENTS\.[^/]+\.md)$/);
    if (dirMatch) return dirMatch[1];
    // Handle legacy AGENTS.md at root
    const rootMatch = relativePath.match(/^([^/]+\.md)$/);
    if (rootMatch) return rootMatch[1];
  }

  // For extensions, strip the extensions/ prefix
  if (kind === "extension") {
    const match = relativePath.match(/^extensions\/(.+)$/);
    if (match) return match[1];
  }

  // Fallback: return the path as-is
  return relativePath;
}

/**
 * Sort artifacts by kind priority, then alphabetically by name.
 */
export function sortArtifacts<T extends { kind: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderA = KIND_SORT_ORDER[a.kind] ?? 100;
    const orderB = KIND_SORT_ORDER[b.kind] ?? 100;
    if (orderA !== orderB) return orderA - orderB;
    // Within same priority tier, sort by kind name then artifact name
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.name.localeCompare(b.name);
  });
}

/**
 * Truncate a string with leading ellipsis if too long.
 */
export function truncatePath(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return "…" + str.slice(-(maxLen - 1));
}

/**
 * Calculate tool column specs.
 */
export interface ToolColumn {
  tool: Tool;
  width: number;
}

export function getToolColumns(tools: Tool[]): ToolColumn[] {
  return tools.map((t) => ({ tool: t, width: Math.max(t.length, 2) }));
}

/**
 * Render table header row.
 */
export function renderHeader(
  kindWidth: number,
  nameWidth: number,
  toolCols: ToolColumn[],
  extraHeaders: Array<{ label: string; width: number }> = []
): void {
  const kindH = chalk.dim("kind".padEnd(kindWidth));
  const nameH = chalk.dim("artifact".padEnd(nameWidth));
  const extraH = extraHeaders.map((h) => chalk.dim(h.label.padStart(h.width)) + "  ").join("");
  const toolH = toolCols.map((c) => chalk.dim(c.tool)).join("  ");
  console.log(`  ${kindH}  ${nameH}  ${extraH}${toolH}`);
}

/**
 * Render table separator row.
 */
export function renderSeparator(
  kindWidth: number,
  nameWidth: number,
  toolCols: ToolColumn[],
  extraWidths: number[] = []
): void {
  const parts = [
    "─".repeat(kindWidth),
    "─".repeat(nameWidth),
    ...extraWidths.map((w) => "─".repeat(w)),
    toolCols.map((c) => "─".repeat(c.width)).join("  "),
  ];
  console.log(chalk.dim(`  ${parts.join("  ")}`));
}

/**
 * Calculate dynamic column widths for kind and name columns.
 */
export function calculateColumnWidths(
  artifacts: Array<{ kind: string; name: string }>,
  minKindWidth = 4,
  maxNameWidth = 35
): { kindWidth: number; nameWidth: number } {
  const kindWidth = Math.max(
    minKindWidth,
    "kind".length,
    ...artifacts.map((a) => a.kind.length)
  );
  const maxNameLen = Math.max(
    "artifact".length,
    ...artifacts.map((a) => a.name.length)
  );
  const nameWidth = Math.min(maxNameLen, maxNameWidth);
  return { kindWidth, nameWidth };
}

// ---------------------------------------------------------------------------
// Change indicators — unified symbols for all commands
// ---------------------------------------------------------------------------

export type ChangeType = "added" | "updated" | "removed" | "unchanged" | "shadowed";

export const CHANGE_SYMBOLS: Record<ChangeType, { symbol: string; color: (s: string) => string }> = {
  added: { symbol: "+", color: chalk.green },
  updated: { symbol: "~", color: chalk.yellow },
  removed: { symbol: "-", color: chalk.red },
  unchanged: { symbol: "✓", color: chalk.green },
  shadowed: { symbol: "?", color: chalk.yellow },
};

// Mode abbreviations for dry-run display
export const MODE_ABBREV: Record<OutputMode, string> = {
  symlink: "sym",
  copy: "copy",
  generate: "gen",
};

// ---------------------------------------------------------------------------
// Artifact change grouping — groups outputs by source artifact
// ---------------------------------------------------------------------------

/**
 * Output info for a single (artifact, tool) pair.
 */
export interface ArtifactOutput {
  tool: Tool;
  targetPath: string;
  mode: OutputMode;
  change: ChangeType;
}

/**
 * Grouped artifact info for table display.
 */
export interface GroupedArtifact {
  kind: string;
  name: string;
  sourcePath: string;
  outputs: Map<Tool, ArtifactOutput>;
  overallChange: ChangeType;
}

/**
 * Get a canonical grouping key for an artifact.
 * For dir-layout kinds (skills), collapses individual files to the parent directory.
 * This ensures skills/foo/SKILL.md and skills/foo/references/bar.md group together.
 */
function getGroupingKey(sourcePath: string, kind: string): string {
  const relativePath = extractRelativePath(sourcePath);
  
  // For skills, extract just the skill directory path
  if (kind === "skill") {
    const match = relativePath.match(/^skills\/([^/]+)/);
    if (match) return `skill:${match[1]}`;
  }

  if (kind === "agent") {
    const match = relativePath.match(/^agents\/(.+)\.md$/);
    if (match) return `agent:${match[1]}`;
  }
  
  // For other kinds, use the full source path
  return sourcePath;
}

/**
 * Group outputs by source artifact, collapsing dir-layout items (skills).
 * Returns artifacts sorted by kind priority then name.
 */
export function groupOutputsByArtifact(
  outputs: Array<{
    spec: { tool: Tool; kind: string; sourcePath: string; targetPath: string; mode: OutputMode };
    change: ChangeType;
  }>
): GroupedArtifact[] {
  const byKey = new Map<string, GroupedArtifact>();

  for (const { spec, change } of outputs) {
    const key = getGroupingKey(spec.sourcePath, spec.kind);
    
    if (!byKey.has(key)) {
      const relativePath = extractRelativePath(spec.sourcePath);
      
      byKey.set(key, {
        kind: spec.kind,
        name: getArtifactName(relativePath, spec.kind),
        sourcePath: spec.sourcePath,
        outputs: new Map(),
        overallChange: "unchanged",
      });
    }

    const artifact = byKey.get(key)!;
    
    // For collapsed artifacts, merge tool outputs (keep worst change per tool)
    const existing = artifact.outputs.get(spec.tool);
    if (!existing || worstChange(existing.change, change) === change) {
      artifact.outputs.set(spec.tool, {
        tool: spec.tool,
        targetPath: spec.targetPath,
        mode: spec.mode,
        change,
      });
    }

    // Update overall change to worst status
    artifact.overallChange = worstChange(artifact.overallChange, change);
  }

  // Convert to array and sort
  const artifacts = Array.from(byKey.values());
  return sortArtifacts(artifacts);
}

/**
 * Determine the "worst" change type (for overall status).
 */
function worstChange(a: ChangeType, b: ChangeType): ChangeType {
  const priority: Record<ChangeType, number> = {
    unchanged: 0,
    added: 1,
    updated: 2,
    shadowed: 3,
    removed: 4,
  };
  return priority[b] > priority[a] ? b : a;
}

// ---------------------------------------------------------------------------
// Change table renderer
// ---------------------------------------------------------------------------

export interface ChangeTableOptions {
  /** Show mode instead of change symbol (for dry-run) */
  showMode?: boolean;
  /** Show action column with overall change */
  showAction?: boolean;
}

/**
 * Render a change table showing artifacts as rows and tools as columns.
 * Cells show change indicators (+, ~, -, ✓) or mode abbreviations.
 */
export function renderChangeTable(
  artifacts: GroupedArtifact[],
  tools: Tool[],
  options: ChangeTableOptions = {}
): void {
  if (artifacts.length === 0) {
    console.log(chalk.dim("  No changes."));
    return;
  }

  const { showMode = false, showAction = false } = options;
  const { kindWidth, nameWidth } = calculateColumnWidths(artifacts);
  const toolCols = getToolColumns(tools);
  const ACTION_W = 8;

  // ── Header ───────────────────────────────────────────────────────────────
  const kindH = chalk.dim("kind".padEnd(kindWidth));
  const nameH = chalk.dim("artifact".padEnd(nameWidth));
  const toolH = toolCols.map((c) => chalk.dim(c.tool)).join("  ");
  const actionH = showAction ? "  " + chalk.dim("action") : "";
  console.log(`  ${kindH}  ${nameH}  ${toolH}${actionH}`);

  // ── Separator ─────────────────────────────────────────────────────────────
  const sepParts = [
    "─".repeat(kindWidth),
    "─".repeat(nameWidth),
    toolCols.map((c) => "─".repeat(c.width)).join("  "),
  ];
  if (showAction) sepParts.push("─".repeat(ACTION_W));
  console.log(chalk.dim(`  ${sepParts.join("  ")}`));

  // ── Rows ──────────────────────────────────────────────────────────────────
  for (const artifact of artifacts) {
    const kindCell = chalk.dim(artifact.kind.padEnd(kindWidth));
    const nameCell = truncatePath(artifact.name, nameWidth).padEnd(nameWidth);

    // Tool cells
    const toolCells = toolCols
      .map((c) => {
        const output = artifact.outputs.get(c.tool);
        if (!output) {
          return chalk.dim("—") + " ".repeat(c.width - 1);
        }

        if (showMode) {
          // Show mode abbreviation
          const abbrev = MODE_ABBREV[output.mode];
          const padded = abbrev.padEnd(c.width);
          return output.change === "unchanged"
            ? chalk.dim(padded)
            : chalk.cyan(padded);
        } else {
          // Show change symbol
          const { symbol, color } = CHANGE_SYMBOLS[output.change];
          return color(symbol) + " ".repeat(c.width - 1);
        }
      })
      .join("  ");

    // Action cell (overall change)
    let actionCell = "";
    if (showAction) {
      const { color } = CHANGE_SYMBOLS[artifact.overallChange];
      actionCell = "  " + color(artifact.overallChange);
    }

    console.log(`  ${kindCell}  ${nameCell}  ${toolCells}${actionCell}`);
  }
}

/**
 * Render a summary line for changes.
 */
export function renderChangeSummary(
  added: number,
  updated: number,
  removed: number
): void {
  const total = added + updated + removed;
  if (total === 0) {
    console.log(chalk.green("✓"), "All outputs in sync");
    return;
  }

  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (removed > 0) parts.push(`${removed} removed`);

  console.log(chalk.green("✓"), `${total} changes: ${parts.join(", ")}`);
}

/**
 * Render a dry-run summary.
 */
export function renderDryRunSummary(
  totalOutputs: number,
  totalTools: number
): void {
  console.log();
  console.log(chalk.dim(`  ${totalOutputs} outputs to ${totalTools} tools`));
}
