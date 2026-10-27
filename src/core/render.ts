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
import * as nodeFs from "node:fs";
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
  readSymlinkTarget,
  ensureDir,
  hashContent,
  walkDir,
} from "../lib/fs.js";

import { registry } from "./registry.js";
import type { OutputMapping } from "./registry.js";
import { rebuildAllGitignores, updateLoadoutsGitignore } from "../lib/gitignore.js";
import { expandTemplate, type TemplateVars } from "./template.js";
import { isUnmanagedCollision, saveState, loadState } from "./manifest.js";
import {
  GENERATED_INSTRUCTIONS_BACKUP,
  GENERATED_INSTRUCTIONS_FILE,
  composeInstructions,
  computeInstructionWarnings,
  detectInstructionConflicts,
  instructionDisplayPath,
  isComposedKind,
  type InstructionConflict,
} from "./instructions.js";
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
  if (mapping.scopes && !mapping.scopes.includes(scope)) return null;

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
  if (mapping.scopes && !mapping.scopes.includes(scope)) return null;

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
 * Check whether an unmanaged collision can be safely adopted.
 *
 * A collision is adoptable when removing the existing file and writing the
 * managed version would be lossless — i.e. the existing file is already what
 * loadouts would render. This covers two cases:
 *
 * 1. The existing file is a symlink pointing at the loadout source (already
 *    correct, just untracked).
 * 2. The existing file's effective content is byte-identical to the rendered
 *    output (covers regular files and symlinks resolving to matching content).
 *
 * In both cases the shadowed file is removed automatically to make way for the
 * managed version, rather than blocking the output as a shadow.
 */
function isAdoptableCollision(
  fullPath: string,
  spec: OutputSpec,
  renderedContent: string
): boolean {
  // Symlink already pointing at the source — already correct, just untracked.
  if (
    spec.mode === "symlink" &&
    isSymlink(fullPath) &&
    readSymlinkTarget(fullPath) === spec.sourcePath
  ) {
    return true;
  }

  // Content-identical (reads through any symlink chain).
  if (isDirectory(fullPath)) return false;
  try {
    return readFile(fullPath) === renderedContent;
  } catch {
    return false;
  }
}

/**
 * Composed (instruction) destinations are adoptable only when the existing
 * file is a symlink into the state root — i.e. something loadouts produced.
 * Content comparison doesn't apply: the destination will point at the
 * generated file, not at any one source.
 */
function isAdoptableComposedCollision(fullPath: string, stateRoot: string): boolean {
  if (!isSymlink(fullPath)) return false;
  try {
    return nodeFs.realpathSync(fullPath).startsWith(nodeFs.realpathSync(stateRoot) + path.sep);
  } catch {
    return false;
  }
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

          if (!spec) continue; // tool doesn't support this kind, or not for this scope

          if (isUnmanagedCollision(state, spec.targetPath, projectRoot)) {
            const fullPath = resolveTargetPath(spec.targetPath, projectRoot);
            const rendered = await renderOutput(expandedItem, spec);
            const adoptable = isComposedKind(spec.kind)
              ? isAdoptableComposedCollision(fullPath, statePath ?? loadout.rootPath)
              : isAdoptableCollision(fullPath, spec, rendered.content);
            if (adoptable) {
              // Existing file is already what loadouts would render — adopt it
              // as a managed output rather than blocking on a shadow.
              outputs.push({ spec, item: expandedItem, hash: rendered.hash });
            } else {
              shadowed.push({
                tool: spec.tool,
                kind: spec.kind,
                sourcePath: spec.sourcePath,
                targetPath: spec.targetPath,
              });
            }
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
// Gitignore freshness
// ---------------------------------------------------------------------------

/**
 * Refresh gitignore files after a filesystem mutation (apply or remove).
 *
 * Every real render/remove now leaves gitignores current, not just artifact
 * add/delete: the managed sections are rebuilt from current definitions, so
 * entries appear for newly added artifacts and stale entries are pruned.
 * Best-effort — gitignore maintenance must never fail a render.
 */
function refreshGitignores(loadoutRoot: string, projectRoot: string, scope: Scope): void {
  try {
    rebuildAllGitignores(loadoutRoot, projectRoot, scope);
    updateLoadoutsGitignore(loadoutRoot);
  } catch {
    // Best-effort: a gitignore failure should never break activation/sync.
  }
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
  await applyMultiPlan([{ loadout, plan }], loadout.rootPath, projectRoot, mode, scope);
}

export interface ApplyResult {
  totalOutputs: number;
  byTool: Map<string, number>;
  changes: {
    updated: string[];  // Artifacts with changed content
    added: string[];    // New artifacts
    removed: string[];  // Removed artifacts
    held: string[];     // Composed outputs left alone because of local edits
  };
  /** Local edits to composed instruction files that held them back. */
  conflicts: InstructionConflict[];
  warnings: string[];
}

/**
 * Change key for an output. Composed outputs share a target, so each source
 * gets its own key; normal outputs are keyed by target alone.
 */
export function changeKey(spec: Pick<OutputSpec, "kind" | "targetPath" | "sourcePath">): string {
  return isComposedKind(spec.kind) ? `${spec.targetPath}\0${spec.sourcePath}` : spec.targetPath;
}

interface BackupItem {
  path: string;
  displayPath: string;
  content: string;
}

function realpathOr(p: string): string {
  try {
    return nodeFs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Write files about to be discarded to the single backup file and return a
 * warning describing it. Returns null when there is nothing to back up.
 */
function writeInstructionBackup(
  loadoutRoot: string,
  projectRoot: string,
  items: BackupItem[]
): string | null {
  const unique = items.filter((item, i) => items.findIndex((o) => o.path === item.path) === i);
  if (unique.length === 0) return null;

  const backupPath = path.join(loadoutRoot, GENERATED_INSTRUCTIONS_BACKUP);
  const now = new Date().toISOString();
  const content =
    unique.length === 1
      ? unique[0].content
      : unique
          .map((item) => {
            const body = item.content.endsWith("\n") ? item.content : `${item.content}\n`;
            return `<!-- loadouts:backup ${item.displayPath} ${now} -->\n${body}`;
          })
          .join("");
  writeFile(backupPath, content);

  return `Saved local edits in ${unique.map((i) => i.displayPath).join(", ")} to ${instructionDisplayPath(backupPath, projectRoot)} before replacing them.`;
}

function conflictBackups(conflicts: InstructionConflict[]): BackupItem[] {
  return conflicts.map((c) => ({ path: c.path, displayPath: c.displayPath, content: readFile(c.path) }));
}

/**
 * Apply multiple loadouts, merging their outputs with deduplication by targetPath.
 * Instruction outputs are composed into one generated file that every
 * instruction destination links to.
 */
export async function applyMultiPlan(
  plans: Array<{ loadout: ResolvedLoadout; plan: RenderPlan }>,
  loadoutRoot: string,
  projectRoot: string,
  mode: OutputMode = "symlink",
  scope: Scope = "project",
  options: { force?: boolean } = {}
): Promise<ApplyResult> {
  // Merge all normal outputs, deduplicating by targetPath but collecting all tools.
  // Composed outputs are handled separately below.
  const outputsByTarget = new Map<string, { output: RenderPlan["outputs"][0]; tools: Set<string> }>();
  const composedSpecs: OutputSpec[] = [];
  const mergedShadowed: ShadowedEntry[] = [];
  const seenShadowedTargets = new Set<string>();

  for (const { plan } of plans) {
    for (const output of plan.outputs) {
      if (isComposedKind(output.spec.kind)) {
        composedSpecs.push(output.spec);
        continue;
      }
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
    for (const s of plan.shadowed) {
      if (!seenShadowedTargets.has(s.targetPath)) {
        seenShadowedTargets.add(s.targetPath);
        mergedShadowed.push(s);
      }
    }
  }

  const mergedOutputs = Array.from(outputsByTarget.values());
  const existingState = loadState(loadoutRoot);
  const oldComposed = existingState?.entries.filter((e) => isComposedKind(e.kind)) ?? [];

  // Compose instructions and look for local edits to the composed files.
  const composition = composeInstructions(plans, { loadoutRoot, projectRoot, scope });
  const generatedPath = path.join(loadoutRoot, GENERATED_INSTRUCTIONS_FILE);
  const detected = detectInstructionConflicts(existingState, composition, projectRoot);
  const keptDestinations = new Set(
    (composition?.destinations ?? []).map((d) => resolveTargetPath(d.targetPath, projectRoot))
  );
  // Only edits to files that would be overwritten hold; files being removed
  // are backed up instead.
  const holding = detected.filter((c) =>
    c.reason === "edited" ? composition !== null : keptDestinations.has(c.path)
  );
  const held = !options.force && holding.length > 0;

  const updated: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const heldKeys: string[] = [];

  // Normal outputs: keyed by target path
  const oldEntries = new Map(existingState?.entries.map((e) => [e.targetPath, e]) ?? []);
  for (const { output } of mergedOutputs) {
    const oldEntry = oldEntries.get(output.spec.targetPath);
    if (!oldEntry) {
      added.push(changeKey(output.spec));
    } else if (oldEntry.renderedHash !== output.hash) {
      updated.push(changeKey(output.spec));
    }
  }

  // Composed outputs: keyed per (target, source)
  const composedKeys = [...new Set(composedSpecs.map(changeKey))];
  if (held) {
    heldKeys.push(...composedKeys);
  } else {
    const sourceByIdentity = new Map(
      (composition?.sources ?? []).map((s) => [realpathOr(s.sourcePath), s])
    );
    const oldSourcesByTarget = new Map(
      oldComposed.map((e) => [
        e.targetPath,
        e.sources ?? [{ path: e.sourcePath, hash: e.renderedHash }],
      ])
    );
    const seen = new Set<string>();
    for (const spec of composedSpecs) {
      const key = changeKey(spec);
      if (seen.has(key)) continue;
      seen.add(key);
      const source = sourceByIdentity.get(realpathOr(spec.sourcePath));
      const old = oldSourcesByTarget
        .get(spec.targetPath)
        ?.find((s) => source && realpathOr(s.path) === realpathOr(source.sourcePath));
      if (!old) added.push(key);
      else if (source && old.hash !== source.hash) updated.push(key);
    }
    const newKeys = new Set(composedKeys);
    for (const entry of oldComposed) {
      const oldSources = entry.sources ?? [{ path: entry.sourcePath, hash: entry.renderedHash }];
      for (const s of oldSources) {
        const key = changeKey({ kind: entry.kind, targetPath: entry.targetPath, sourcePath: s.path });
        if (!newKeys.has(key) && !removed.includes(key)) removed.push(key);
      }
    }
  }

  // Back up anything with local edits that is about to be discarded.
  const warnings: string[] = [];
  if (!held) {
    const backups = conflictBackups(detected);
    const trackedGenerated = oldComposed.some((e) => e.sources && e.sourcePath === generatedPath);
    if (!trackedGenerated && fileExists(generatedPath) && !isDirectory(generatedPath)) {
      const current = readFile(generatedPath);
      if (composition === null || current !== composition.content) {
        backups.push({
          path: generatedPath,
          displayPath: instructionDisplayPath(generatedPath, projectRoot),
          content: current,
        });
      }
    }
    const backupWarning = writeInstructionBackup(loadoutRoot, projectRoot, backups);
    if (backupWarning) warnings.push(backupWarning);
  }

  // Remove stale managed outputs
  const normalTargets = new Set(mergedOutputs.map((o) => o.output.spec.targetPath));
  const composedTargets = new Set(
    held
      ? oldComposed.map((e) => e.targetPath)
      : (composition?.destinations ?? []).map((d) => d.targetPath)
  );
  const prunedTargets: string[] = [];
  if (existingState) {
    for (const entry of existingState.entries) {
      if (normalTargets.has(entry.targetPath) || composedTargets.has(entry.targetPath)) continue;
      if (held && isComposedKind(entry.kind)) continue;
      if (!isComposedKind(entry.kind)) removed.push(entry.targetPath);
      removePath(resolveTargetPath(entry.targetPath, projectRoot));
      prunedTargets.push(entry.targetPath);
    }
  }

  await removeEmptyParentDirs(prunedTargets, projectRoot);

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

  // Write the composed file and link every destination to it
  if (!held) {
    if (composition) {
      writeFile(generatedPath, composition.content);
      for (const dest of composition.destinations) {
        const targetPath = resolveTargetPath(dest.targetPath, projectRoot);
        prepareOutputTarget(targetPath);
        createSymlink(generatedPath, targetPath);
      }
    } else if (fileExists(generatedPath) || isSymlink(generatedPath)) {
      removePath(generatedPath);
    }
  }

  for (const dest of composition?.destinations ?? []) {
    for (const tool of dest.tools) {
      byTool.set(tool, (byTool.get(tool) || 0) + 1);
    }
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

  if (held) {
    entries.push(...oldComposed);
  } else if (composition) {
    const sources = composition.sources.map((s) => ({ path: s.sourcePath, hash: s.hash }));
    for (const dest of composition.destinations) {
      entries.push({
        tools: dest.tools,
        kind: "instruction",
        sourcePath: generatedPath,
        targetPath: dest.targetPath,
        mode: "symlink",
        renderedHash: composition.hash,
        sources,
      });
    }
  }

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

  refreshGitignores(loadoutRoot, projectRoot, scope);

  // Suppression warnings depend on disk, so compute them after pruning.
  if (composition) {
    warnings.unshift(
      ...computeInstructionWarnings(composition.content, composition.destinations, projectRoot, scope)
    );
  }

  return {
    totalOutputs: mergedOutputs.length + (composition?.destinations.length ?? 0),
    byTool,
    changes: { updated, added, removed, held: heldKeys },
    conflicts: held ? detected : [],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

/**
 * Remove all managed outputs recorded in the state file.
 * Does NOT clear the state file — callers decide whether to call clearState().
 * Composed instruction files with local edits are backed up before removal.
 */
export async function removeManaged(
  loadoutRoot: string,
  projectRoot: string,
  scope: Scope = "project"
): Promise<{ removed: string[]; missing: string[]; warnings: string[] }> {
  const state = loadState(loadoutRoot);
  const removed: string[] = [];
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!state) return { removed, missing, warnings };

  const backupWarning = writeInstructionBackup(
    loadoutRoot,
    projectRoot,
    conflictBackups(detectInstructionConflicts(state, null, projectRoot))
  );
  if (backupWarning) warnings.push(backupWarning);

  for (const entry of state.entries) {
    const fullPath = resolveTargetPath(entry.targetPath, projectRoot);

    if (fileExists(fullPath) || isDirectory(fullPath) || isSymlink(fullPath)) {
      removePath(fullPath);
      removed.push(entry.targetPath);
    } else {
      missing.push(entry.targetPath);
    }
  }

  if (state.entries.some((e) => isComposedKind(e.kind))) {
    const generatedPath = path.join(loadoutRoot, GENERATED_INSTRUCTIONS_FILE);
    if (fileExists(generatedPath) || isSymlink(generatedPath)) removePath(generatedPath);
  }

  await removeEmptyParentDirs(state.entries.map((entry) => entry.targetPath), projectRoot);

  refreshGitignores(loadoutRoot, projectRoot, scope);

  return { removed, missing, warnings };
}
