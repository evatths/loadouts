/**
 * Generic render pipeline.
 *
 * planRender()  — computes what would be written without touching disk.
 * renderOutput() — renders one (item, spec) pair to content + hash.
 * applyPlan()   — writes the plan to disk and saves state.
 * removeManaged() — removes all outputs recorded in a state file.
 *
 * All tool/kind logic is delegated to the registry; this module contains
 * no per-tool or per-kind switch statements.
 */

import * as path from "node:path";
import * as os from "node:os";
import {
  createSymlink,
  writeFile,
  removeFile,
  removeDir,
  removePath,
  readFile,
  fileExists,
  isDirectory,
  isSymlink,
  ensureDir,
  hashContent,
  walkDir,
} from "../lib/fs.js";

import { registry } from "./registry.js";
import type { OutputMapping } from "./registry.js";
import { expandTemplate, type TemplateVars } from "./template.js";
import { isUnmanagedCollision, saveState, loadState } from "./manifest.js";
import type {
  ResolvedLoadout,
  ResolvedItem,
  OutputSpec,
  RenderedOutput,
  RenderPlan,
  ManifestEntry,
  ShadowedEntry,
  AppliedState,
  OutputMode,
  Scope,
} from "./types.js";

// ---------------------------------------------------------------------------
// Output spec resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the OutputSpec for one (item, tool) pair using the registry.
 * Returns null if the tool doesn't support this kind or has no mapping.
 */
export function resolveOutputSpec(
  toolName: string,
  item: ResolvedItem,
  scope: Scope
): OutputSpec | null {
  const mapping = registry.resolveMapping(toolName, item.kind);
  if (!mapping) return null;

  const tool = registry.getTool(toolName)!;
  const sourceExt = path.extname(item.sourcePath);
  const ext = mapping.ext ?? sourceExt;

  const vars: TemplateVars = {
    base: tool.basePath[scope],
    home: os.homedir(),
    stem: path.basename(item.sourcePath, sourceExt),
    ext,
    name: path.basename(item.sourcePath),
    relative: item.relativePath,
    kind: item.kind,
  };

  const targetPath = expandTemplate(mapping.path, scope, vars);
  const mode = resolveMappingMode(mapping, item);

  return {
    tool: toolName,
    kind: item.kind,
    sourcePath: item.sourcePath,
    targetPath,
    mode,
  };
}

function resolveMappingMode(mapping: OutputMapping, item: ResolvedItem): OutputMode {
  if (typeof mapping.mode === "function") {
    return mapping.mode(item);
  }

  return mapping.mode ??
    (mapping.generate ? "generate" : mapping.transform ? "copy" : "symlink");
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render one (item, spec) pair to content + hash.
 * No disk I/O — used for planning, token estimation, and copy/generate writes.
 *
 * All items are now file-based (dir-layout items are expanded in planRender).
 */
export async function renderOutput(
  item: ResolvedItem,
  spec: OutputSpec
): Promise<RenderedOutput> {
  const kind = registry.getKind(spec.kind);
  if (!kind) throw new Error(`Unknown kind: "${spec.kind}"`);

  const mapping = registry.resolveMapping(spec.tool, spec.kind);

  // generate mode: produce content from a registered generator
  if (mapping?.generate && spec.mode !== "symlink") {
    const content = mapping.generate(item);
    return { content, hash: hashContent(content) };
  }

  // file-layout: read source, optionally transform
  const raw = readFile(item.sourcePath);

  if (spec.mode === "symlink") {
    return { content: raw, hash: hashContent(raw) };
  }

  if (mapping?.transform) {
    const transformFn =
      typeof mapping.transform === "string"
        ? registry.getTransform(mapping.transform)
        : mapping.transform;
    if (!transformFn) {
      throw new Error(`Transform "${mapping.transform}" is not registered.`);
    }
    const content = transformFn(raw, item);
    return { content, hash: hashContent(content) };
  }

  return { content: raw, hash: hashContent(raw) };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Expand a dir-layout item into individual file items.
 * Preserves the subdirectory structure within the directory.
 */
function expandDirItem(
  item: ResolvedItem,
  kind: { layout: "file" | "dir" }
): ResolvedItem[] {
  if (kind.layout !== "dir" || !isDirectory(item.sourcePath)) {
    return [item];
  }

  const files = walkDir(item.sourcePath);
  return files.map((relativeFile) => ({
    kind: item.kind,
    sourcePath: path.join(item.sourcePath, relativeFile),
    relativePath: path.join(item.relativePath, relativeFile),
    tools: item.tools,
  }));
}

/**
 * Resolve output spec for an expanded file within a dir-layout item.
 * Uses the base directory's mapping but adjusts paths for the specific file.
 */
function resolveExpandedOutputSpec(
  toolName: string,
  baseItem: ResolvedItem,
  expandedItem: ResolvedItem,
  scope: Scope
): OutputSpec | null {
  const mapping = registry.resolveMapping(toolName, baseItem.kind);
  if (!mapping) return null;

  const tool = registry.getTool(toolName)!;
  const sourceExt = path.extname(expandedItem.sourcePath);
  const ext = mapping.ext ?? sourceExt;

  // Get the relative path within the skill directory
  const relativeWithinDir = path.relative(baseItem.sourcePath, expandedItem.sourcePath);

  const vars: TemplateVars = {
    base: tool.basePath[scope],
    home: os.homedir(),
    stem: path.basename(baseItem.sourcePath), // Use the directory name as stem
    ext,
    name: path.basename(baseItem.sourcePath),
    relative: baseItem.relativePath,
    kind: baseItem.kind,
  };

  // Expand the template to get the base target path (e.g., .cursor/skills/debug)
  const baseTargetPath = expandTemplate(mapping.path, scope, vars);
  // Append the relative file path within the directory
  const targetPath = path.join(baseTargetPath, relativeWithinDir);

  const mode = resolveMappingMode(mapping, expandedItem);

  return {
    tool: toolName,
    kind: expandedItem.kind,
    sourcePath: expandedItem.sourcePath,
    targetPath,
    mode,
  };
}

/**
 * Compute what would be written for a resolved loadout without touching disk.
 *
 * Dir-layout items (skills) are expanded into individual file outputs,
 * allowing users to have custom files alongside loadout-managed ones.
 */
export async function planRender(
  loadout: ResolvedLoadout,
  projectRoot: string,
  scope: Scope,
  statePath?: string
): Promise<RenderPlan> {
  // Use explicit statePath if provided, otherwise fall back to loadout's root.
  // This is critical for bundled loadouts which don't have their own state file—
  // they share state with the scope that activated them.
  const state = loadState(statePath ?? loadout.rootPath);
  const outputs: RenderPlan["outputs"] = [];
  const shadowed: ShadowedEntry[] = [];
  const errors: string[] = [];

  for (const item of loadout.items) {
    const kind = registry.getKind(item.kind);
    if (!kind) {
      errors.push(`${item.relativePath}: Unknown kind "${item.kind}"`);
      continue;
    }

    // Expand dir-layout items into individual files
    const expandedItems = expandDirItem(item, kind);

    for (const expandedItem of expandedItems) {
      for (const toolName of expandedItem.tools) {
        try {
          // Use expanded spec resolver for dir-layout items
          const spec =
            kind.layout === "dir"
              ? resolveExpandedOutputSpec(toolName, item, expandedItem, scope)
              : resolveOutputSpec(toolName, expandedItem, scope);

          if (!spec) continue; // tool doesn't support this kind

          if (isUnmanagedCollision(state, spec.targetPath, projectRoot)) {
            shadowed.push({
              tool: spec.tool,
              kind: spec.kind,
              sourcePath: spec.sourcePath,
              targetPath: spec.targetPath,
            });
            continue;
          }

          const rendered = await renderOutput(expandedItem, spec);
          outputs.push({ spec, item: expandedItem, hash: rendered.hash });
        } catch (err) {
          errors.push(
            `${expandedItem.relativePath} → ${toolName}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  return { outputs, shadowed, errors };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Resolve a target path to an absolute path.
 * Handles both relative paths (project scope) and absolute paths (global scope).
 */
function resolveTargetPath(targetPath: string, projectRoot: string): string {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.join(projectRoot, targetPath);
}

function collectParentDirs(
  targetPaths: string[],
  projectRoot: string
): string[] {
  const dirs = new Set<string>();

  for (const targetPath of targetPaths) {
    let dir = path.dirname(resolveTargetPath(targetPath, projectRoot));
    while (dir !== projectRoot && dir !== path.dirname(dir)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }

  return [...dirs].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length
  );
}

async function removeEmptyParentDirs(
  targetPaths: string[],
  projectRoot: string
): Promise<void> {
  if (targetPaths.length === 0) return;

  const dirs = collectParentDirs(targetPaths, projectRoot);
  const fs = await import("node:fs");

  for (const dir of dirs) {
    try {
      if (isSymlink(dir)) continue;
      if (fs.readdirSync(dir).length === 0) removeDir(dir);
    } catch {
      // Ignore — dir may not exist or may be unremovable
    }
  }
}

/**
 * Replace the existing output target with a writable parent directory.
 */
function prepareOutputTarget(targetPath: string): void {
  removePath(targetPath);
  ensureDir(path.dirname(targetPath));
}


/**
 * Apply a render plan to disk and save state.
 *
 * `mode` is top-level metadata recorded in the state file; per-output modes
 * live on each spec and govern the actual write strategy.
 */
export async function applyPlan(
  plan: RenderPlan,
  loadout: ResolvedLoadout,
  projectRoot: string,
  mode: OutputMode = "symlink",
  scope: Scope = "project"
): Promise<void> {
  // Remove stale managed outputs not included in the new plan
  const existingState = loadState(loadout.rootPath);
  const removedTargets: string[] = [];
  if (existingState) {
    const newTargets = new Set(plan.outputs.map((o) => o.spec.targetPath));
    for (const entry of existingState.entries) {
      if (!newTargets.has(entry.targetPath)) {
        const fullPath = resolveTargetPath(entry.targetPath, projectRoot);
        removePath(fullPath);
        removedTargets.push(entry.targetPath);
      }
    }
  }

  await removeEmptyParentDirs(removedTargets, projectRoot);

  // Write each planned output
  for (const { spec, item } of plan.outputs) {
    const targetPath = resolveTargetPath(spec.targetPath, projectRoot);

    prepareOutputTarget(targetPath);

    if (spec.mode === "symlink") {
      createSymlink(spec.sourcePath, targetPath);
    } else {
      // copy or generate — write rendered content
      const rendered = await renderOutput(item, spec);
      writeFile(targetPath, rendered.content);
    }
  }

  // Build manifest entries from plan outputs, grouping tools by targetPath
  const outputsByTarget = new Map<string, { output: typeof plan.outputs[0]; tools: Set<string> }>();
  for (const output of plan.outputs) {
    const existing = outputsByTarget.get(output.spec.targetPath);
    if (existing) {
      existing.tools.add(output.spec.tool);
    } else {
      outputsByTarget.set(output.spec.targetPath, {
        output,
        tools: new Set([output.spec.tool]),
      });
    }
  }
  
  const entries: ManifestEntry[] = Array.from(outputsByTarget.values()).map(({ output: { spec, hash }, tools }) => ({
    tools: Array.from(tools).sort(),
    kind: spec.kind,
    sourcePath: spec.sourcePath,
    targetPath: spec.targetPath,
    mode: spec.mode,
    renderedHash: hash,
  }));

  const newState: AppliedState = {
    active: [loadout.name],
    mode,
    appliedAt: new Date().toISOString(),
    entries,
    shadowed: plan.shadowed,
  };

  saveState(loadout.rootPath, newState);

  // Clean up fallback marker now that real state exists
  const fallbackMarker = path.join(loadout.rootPath, ".fallback-applied");
  if (fileExists(fallbackMarker)) {
    removeFile(fallbackMarker);
  }

}

export interface ApplyResult {
  totalOutputs: number;
  byTool: Map<string, number>;
  changes: {
    updated: string[];  // Artifacts with changed content
    added: string[];    // New artifacts
    removed: string[];  // Removed artifacts
  };
}

/**
 * Apply multiple loadouts, merging their outputs with deduplication by targetPath.
 */
export async function applyMultiPlan(
  plans: Array<{ loadout: ResolvedLoadout; plan: RenderPlan }>,
  loadoutRoot: string,
  projectRoot: string,
  mode: OutputMode = "symlink",
  scope: Scope = "project"
): Promise<ApplyResult> {
  // Merge all outputs, deduplicating by targetPath but collecting all tools
  const outputsByTarget = new Map<string, { output: RenderPlan["outputs"][0]; tools: Set<string> }>();
  const mergedShadowed: ShadowedEntry[] = [];
  const seenShadowedTargets = new Set<string>();
  
  for (const { plan } of plans) {
    for (const output of plan.outputs) {
      const existing = outputsByTarget.get(output.spec.targetPath);
      if (existing) {
        // Same target path, collect the tool
        existing.tools.add(output.spec.tool);
      } else {
        // First output for this target
        outputsByTarget.set(output.spec.targetPath, {
          output,
          tools: new Set([output.spec.tool]),
        });
      }
    }
    for (const s of plan.shadowed) {
      if (!seenShadowedTargets.has(s.targetPath)) {
        seenShadowedTargets.add(s.targetPath);
        mergedShadowed.push(s);
      }
    }
  }
  
  const mergedOutputs = Array.from(outputsByTarget.values());

  // Detect changes
  const existingState = loadState(loadoutRoot);
  const oldEntries = new Map(existingState?.entries.map(e => [e.targetPath, e]) ?? []);
  const newHashes = new Map(mergedOutputs.map(o => [o.output.spec.targetPath, o.output.hash]));
  
  const updated: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  
  // Find updated and added
  for (const { output } of mergedOutputs) {
    const oldEntry = oldEntries.get(output.spec.targetPath);
    if (!oldEntry) {
      added.push(output.spec.targetPath);
    } else if (oldEntry.renderedHash !== output.hash) {
      updated.push(output.spec.targetPath);
    }
  }
  
  // Find removed
  const newTargets = new Set(mergedOutputs.map((o) => o.output.spec.targetPath));
  if (existingState) {
    for (const entry of existingState.entries) {
      if (!newTargets.has(entry.targetPath)) {
        removed.push(entry.targetPath);
        const fullPath = resolveTargetPath(entry.targetPath, projectRoot);
        removePath(fullPath);
      }
    }
  }

  await removeEmptyParentDirs(removed, projectRoot);

  // Write each merged output
  const byTool = new Map<string, number>();
  for (const { output: { spec, item } } of mergedOutputs) {
    const targetPath = resolveTargetPath(spec.targetPath, projectRoot);

    prepareOutputTarget(targetPath);

    if (spec.mode === "symlink") {
      createSymlink(spec.sourcePath, targetPath);
    } else {
      // copy or generate — write rendered content
      const rendered = await renderOutput(item, spec);
      writeFile(targetPath, rendered.content);
    }

    byTool.set(spec.tool, (byTool.get(spec.tool) || 0) + 1);
  }

  // Build manifest entries with all tools that share each output
  const entries: ManifestEntry[] = mergedOutputs.map(({ output: { spec, hash }, tools }) => ({
    tools: Array.from(tools).sort(),
    kind: spec.kind,
    sourcePath: spec.sourcePath,
    targetPath: spec.targetPath,
    mode: spec.mode,
    renderedHash: hash,
  }));

  const activeNames = plans.map((p) => p.loadout.name);
  const newState: AppliedState = {
    active: activeNames,
    mode,
    appliedAt: new Date().toISOString(),
    entries,
    shadowed: mergedShadowed,
  };

  saveState(loadoutRoot, newState);

  // Clean up fallback marker now that real state exists
  const fallbackMarker = path.join(loadoutRoot, ".fallback-applied");
  if (fileExists(fallbackMarker)) {
    removeFile(fallbackMarker);
  }

  return {
    totalOutputs: mergedOutputs.length,
    byTool,
    changes: { updated, added, removed },
  };
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove all managed outputs recorded in the state file.
 * Does NOT clear the state file — callers decide whether to call clearState().
 */
export async function removeManaged(
  loadoutRoot: string,
  projectRoot: string,
  scope: Scope = "project"
): Promise<{ removed: string[]; missing: string[] }> {
  const state = loadState(loadoutRoot);
  const removed: string[] = [];
  const missing: string[] = [];

  if (!state) return { removed, missing };

  for (const entry of state.entries) {
    const fullPath = resolveTargetPath(entry.targetPath, projectRoot);

    if (fileExists(fullPath) || isDirectory(fullPath) || isSymlink(fullPath)) {
      removePath(fullPath);
      removed.push(entry.targetPath);
    } else {
      missing.push(entry.targetPath);
    }
  }

  await removeEmptyParentDirs(state.entries.map((entry) => entry.targetPath), projectRoot);

  return { removed, missing };
}
