/**
 * Ownership manifest and drift detection
 */

import * as path from "node:path";
import * as yaml from "yaml";
import {
  fileExists,
  readFile,
  writeFile,
  removeFile,
  isSymlink,
  readSymlinkTarget,
  hashFile,
  hashDir,
  isDirectory,
} from "../lib/fs.js";
import { AppliedStateSchema, LegacyAppliedStateSchema, LegacyManifestEntrySchema } from "./schema.js";
import { z } from "zod";
import type { AppliedState, ManifestEntry, OutputMode } from "./types.js";

const STATE_FILE = ".state.json";

/**
 * Get the path to the state file in a loadout root.
 */
function getStatePath(loadoutRoot: string): string {
  return path.join(loadoutRoot, STATE_FILE);
}

/**
 * Load the applied state from disk.
 * Handles migration from legacy single-loadout format to multi-loadout format.
 */
export function loadState(loadoutRoot: string): AppliedState | null {
  const statePath = getStatePath(loadoutRoot);

  if (!fileExists(statePath)) {
    return null;
  }

  try {
    const content = readFile(statePath);
    const parsed = JSON.parse(content);
    
    // Try new format first (multi-loadout, multi-tool)
    const newFormat = AppliedStateSchema.safeParse(parsed);
    if (newFormat.success) {
      return newFormat.data;
    }
    
    // Try single-tool entries format (active[] but tool instead of tools)
    const singleToolFormat = z.object({
      active: z.array(z.string()),
      mode: z.enum(["symlink", "copy", "generate"]),
      appliedAt: z.string(),
      entries: z.array(LegacyManifestEntrySchema),
      shadowed: z.array(z.object({
        tool: z.string(),
        kind: z.string(),
        sourcePath: z.string(),
        targetPath: z.string(),
      })).default([]),
    }).safeParse(parsed);
    
    if (singleToolFormat.success) {
      return {
        active: singleToolFormat.data.active,
        mode: singleToolFormat.data.mode,
        appliedAt: singleToolFormat.data.appliedAt,
        entries: singleToolFormat.data.entries.map(e => ({
          ...e,
          tools: [e.tool],
        })),
        shadowed: singleToolFormat.data.shadowed,
      };
    }
    
    // Try legacy single-loadout format (loadout instead of active)
    const legacyFormat = LegacyAppliedStateSchema.safeParse(parsed);
    if (legacyFormat.success) {
      return {
        active: [legacyFormat.data.loadout],
        mode: legacyFormat.data.mode,
        appliedAt: legacyFormat.data.appliedAt,
        entries: legacyFormat.data.entries.map((e: z.infer<typeof LegacyManifestEntrySchema>) => ({
          ...e,
          tools: [e.tool],
        })),
        shadowed: legacyFormat.data.shadowed,
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Save the applied state to disk.
 */
export function saveState(loadoutRoot: string, state: AppliedState): void {
  const statePath = getStatePath(loadoutRoot);
  writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Clear the applied state.
 */
export function clearState(loadoutRoot: string): void {
  const statePath = getStatePath(loadoutRoot);
  removeFile(statePath);
}

/**
 * Check if a target path is owned by the manifest.
 */
export function isOwned(state: AppliedState | null, targetPath: string): boolean {
  if (!state) return false;
  return state.entries.some((e) => e.targetPath === targetPath);
}

/**
 * Check if a target path exists and is NOT owned by the manifest.
 * This is what we need to detect before overwriting.
 */
export function isUnmanagedCollision(
  state: AppliedState | null,
  targetPath: string,
  projectRoot: string
): boolean {
  // Handle both absolute (global) and relative (project) target paths
  const fullPath = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(projectRoot, targetPath);

  if (!fileExists(fullPath) && !isDirectory(fullPath)) {
    return false; // Doesn't exist, no collision
  }

  return !isOwned(state, targetPath);
}

/**
 * Detect drift in managed outputs.
 */
export interface DriftResult {
  entry: ManifestEntry;
  status: "ok" | "missing" | "modified" | "unlinked" | "broken" | "misdirected";
}

export function detectDrift(
  state: AppliedState,
  projectRoot: string
): DriftResult[] {
  const results: DriftResult[] = [];

  for (const entry of state.entries) {
    // Handle both absolute (global) and relative (project) target paths
    const fullPath = path.isAbsolute(entry.targetPath)
      ? entry.targetPath
      : path.join(projectRoot, entry.targetPath);

    if (!fileExists(fullPath) && !isDirectory(fullPath)) {
      results.push({ entry, status: "missing" });
      continue;
    }

    // Check if symlink was converted to regular file
    if (entry.mode === "symlink" && !isSymlink(fullPath)) {
      results.push({ entry, status: "unlinked" });
      continue;
    }

    // Check if symlink points to the expected source
    if (entry.mode === "symlink") {
      const actualTarget = readSymlinkTarget(fullPath);
      if (actualTarget !== entry.sourcePath) {
        results.push({ entry, status: "misdirected" });
        continue;
      }
    }

    // Check hash — for symlinks, check source; for copy/generate, check target
    const hashPath = entry.mode === "symlink" ? entry.sourcePath : fullPath;

    // For symlinks, if source file was deleted, it's a broken symlink
    if (entry.mode === "symlink" && !fileExists(hashPath) && !isDirectory(hashPath)) {
      results.push({ entry, status: "broken" });
      continue;
    }

    const currentHash = isDirectory(hashPath)
      ? hashDir(hashPath)
      : hashFile(hashPath);

    if (currentHash !== entry.renderedHash) {
      results.push({ entry, status: "modified" });
      continue;
    }

    results.push({ entry, status: "ok" });
  }

  return results;
}

/** Inputs of an entry: its recorded sources for composed outputs, else its sourcePath. */
export function entrySources(entry: ManifestEntry): string[] {
  return entry.sources?.map((s) => s.path) ?? [entry.sourcePath];
}

/**
 * Fan composed results out to one result per source, so per-artifact views see
 * each instruction source rather than the generated file.
 */
export function expandDriftBySource(results: DriftResult[]): DriftResult[] {
  return results.flatMap((result) =>
    result.entry.sources
      ? result.entry.sources.map((s) => ({
          ...result,
          entry: { ...result.entry, sourcePath: s.path },
        }))
      : [result]
  );
}

/**
 * Get all target paths that would be affected by applying new entries.
 */
export function getAffectedPaths(entries: ManifestEntry[]): Set<string> {
  return new Set(entries.map((e) => e.targetPath));
}
