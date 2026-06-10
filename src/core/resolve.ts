/**
 * Resolve loadout graphs and included items
 */

import * as path from "node:path";
import {
  findLoadoutDefinition,
  parseRootConfig,
} from "./config.js";
import { registry } from "./registry.js";
import { loadYamlKindsFromRoots } from "./kindLoader.js";
import { fileExists, isDirectory } from "../lib/fs.js";
import { discoverLoadoutRoots, getGlobalRoot, collectRootsWithSources } from "./discovery.js";
import type {
  LoadoutRoot,
  LoadoutDefinition,
  LoadoutInclude,
  ResolvedItem,
  ResolvedLoadout,
  Tool,
  RootConfig,
  CommandContext,
} from "./types.js";
import { BUILTIN_TOOL_NAMES } from "../builtins/index.js";

/**
 * Resolve a loadout by name.
 */
export function resolveLoadout(
  name: string,
  roots: LoadoutRoot[],
  rootConfig?: RootConfig
): ResolvedLoadout {
  // Load any YAML-defined kinds from the discovered roots before resolving
  // items, so inferKind() can match custom kinds. Idempotent.
  loadYamlKindsFromRoots(roots);

  const found = findLoadoutDefinition(name, roots);
  if (!found) {
    throw new Error(`Loadout not found: ${name}`);
  }

  const { definition, rootPath } = found;
  const effectiveTools = definition.tools || rootConfig?.tools || [...BUILTIN_TOOL_NAMES];

  const items: ResolvedItem[] = [];
  for (const include of definition.include || []) {
    items.push(resolveInclude(include, rootPath, effectiveTools));
  }

  return {
    name,
    description: definition.description,
    tools: effectiveTools,
    items,
    rootPath,
  };
}

/**
 * Resolve a single include entry to a ResolvedItem.
 */
function resolveInclude(
  include: LoadoutInclude,
  rootPath: string,
  defaultTools: Tool[]
): ResolvedItem {
  const relativePath = typeof include === "string" ? include : include.path;
  const tools =
    typeof include === "object" && include.tools
      ? include.tools
      : defaultTools;

  const sourcePath = path.join(rootPath, relativePath);

  // Validate the source exists
  if (!fileExists(sourcePath) && !isDirectory(sourcePath)) {
    throw new Error(`Include not found: ${relativePath} (in ${rootPath})`);
  }

  const kind = registry.inferKind(relativePath);
  if (!kind) {
    throw new Error(`Cannot infer artifact kind for path: ${relativePath}`);
  }

  return {
    kind,
    sourcePath,
    relativePath,
    tools,
  };
}

/**
 * Check if instructions (AGENTS.md) exist in the loadout root.
 */
export function hasInstructions(loadoutRoot: string): boolean {
  return fileExists(path.join(loadoutRoot, "AGENTS.md"));
}

/**
 * Get the instruction item if it exists.
 */
export function getInstructionItem(
  loadoutRoot: string,
  tools: Tool[]
): ResolvedItem | null {
  const sourcePath = path.join(loadoutRoot, "AGENTS.md");

  if (!fileExists(sourcePath)) {
    return null;
  }

  return {
    kind: "instruction",
    sourcePath,
    relativePath: "AGENTS.md",
    tools,
  };
}

/**
 * Result of loading and fully resolving a loadout for a command context.
 */
export interface LoadResult {
  loadout: ResolvedLoadout;
  rootConfig: RootConfig;
  loadoutName: string;
  roots: LoadoutRoot[];
  sourceWarnings: string[];
}

export interface LoadManyResult {
  loadouts: ResolvedLoadout[];
  rootConfig: RootConfig;
  loadoutNames: string[];
  roots: LoadoutRoot[];
  sourceWarnings: string[];
}

export interface LoadResolvedLoadoutsOptions {
  includeBundled?: boolean;
}

async function collectContextRoots(
  ctx: CommandContext,
  includeBundled: boolean
): Promise<{ roots: LoadoutRoot[]; sourceWarnings: string[] }> {
  let roots: LoadoutRoot[];
  let sourceWarnings: string[] = [];

  if (ctx.scope === "global") {
    const globalRoot = getGlobalRoot();
    if (!globalRoot) {
      throw new Error("No global loadout found at ~/.config/loadouts");
    }
    const collected = collectRootsWithSources(globalRoot, false, includeBundled);
    roots = collected.roots;
    sourceWarnings = collected.warnings;
  } else {
    const discovered = await discoverLoadoutRoots(ctx.projectRoot);
    if (discovered.length === 0) {
      throw new Error("No .loadouts/ directory found. Run 'loadouts init' first.");
    }
    const primaryRoot = discovered[0];
    const collected = collectRootsWithSources(primaryRoot, true, includeBundled);
    roots = collected.roots;
    sourceWarnings = collected.warnings;
  }

  return { roots, sourceWarnings };
}

export async function loadResolvedLoadouts(
  ctx: CommandContext,
  names?: string[],
  options: LoadResolvedLoadoutsOptions = {}
): Promise<LoadManyResult> {
  const includeBundled = options.includeBundled ?? false;
  const { roots, sourceWarnings } = await collectContextRoots(ctx, includeBundled);

  const rootConfig = parseRootConfig(ctx.configPath);
  const loadoutNames = names && names.length > 0
    ? names
    : [rootConfig.default || "base"];

  const loadouts: ResolvedLoadout[] = [];
  for (const loadoutName of loadoutNames) {
    const loadout = resolveLoadout(loadoutName, roots, rootConfig);

    const alreadyHasInstruction = loadout.items.some(
      (i) => i.relativePath === "AGENTS.md"
    );
    if (!alreadyHasInstruction) {
      const instructionItem = getInstructionItem(ctx.configPath, loadout.tools);
      if (instructionItem) loadout.items.push(instructionItem);
    }

    loadouts.push(loadout);
  }

  return { loadouts, rootConfig, loadoutNames, roots, sourceWarnings };
}

/**
 * Discover roots, parse root config, resolve the loadout, and attach the
 * instruction item if present. Throws on any failure — callers decide whether
 * to exit. This consolidates the pattern previously duplicated across apply,
 * diff, info, init, and global commands.
 *
 * Root collection order:
 *   1. Primary .loadouts/ (from ctx.configPath)
 *   2. Sources declared in loadout.yaml (transitively)
 *   3. Global ~/.config/loadouts/ (lowest priority)
 */
export async function loadResolvedLoadout(
  ctx: CommandContext,
  name?: string,
  options: LoadResolvedLoadoutsOptions = {}
): Promise<LoadResult> {
  const result = await loadResolvedLoadouts(ctx, name ? [name] : undefined, options);
  return {
    loadout: result.loadouts[0],
    rootConfig: result.rootConfig,
    loadoutName: result.loadoutNames[0],
    roots: result.roots,
    sourceWarnings: result.sourceWarnings,
  };
}
