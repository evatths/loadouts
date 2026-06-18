/**
 * Shared utilities for artifact path handling.
 * 
 * Consolidates logic for:
 * - Determining if a root level is global scope
 * - Extracting relative artifact paths from absolute source paths
 */

import * as path from "node:path";
import type { LoadoutRoot } from "../core/types.js";

/**
 * Check if a root level represents global scope.
 * Both "global" and "bundled" roots are global scope.
 */
export function isGlobalScope(level: LoadoutRoot["level"]): boolean {
  return level === "global" || level === "bundled";
}

/**
 * Check if a root level represents project/local scope.
 */
export function isProjectScope(level: LoadoutRoot["level"]): boolean {
  return level === "project";
}

/**
 * Extract the relative artifact path from an absolute source path.
 * 
 * Handles:
 * - .loadouts/ directories (project and global)
 * - bundled/ directory (ships with CLI)
 * 
 * Returns the path relative to the loadouts/bundled root, e.g.:
 * - "/path/to/.loadouts/rules/my-rule.md" → "rules/my-rule.md"
 * - "/path/to/bundled/skills/my-skill/SKILL.md" → "skills/my-skill/SKILL.md"
 */
export function extractRelativePath(sourcePath: string): string {
  const parts = sourcePath.split(path.sep);
  
  // Check for bundled directory first (more specific)
  const bundledIdx = parts.findIndex(p => p === "bundled");
  if (bundledIdx >= 0) {
    return parts.slice(bundledIdx + 1).join("/");
  }
  
  // Check for .loadouts directory (project scope)
  const dotLoadoutIdx = parts.findIndex(p => p === ".loadouts");
  if (dotLoadoutIdx >= 0) {
    return parts.slice(dotLoadoutIdx + 1).join("/");
  }
  
  // Check for loadouts directory (global scope: ~/.config/loadouts)
  const loadoutIdx = parts.findIndex(p => p === "loadouts");
  if (loadoutIdx >= 0) {
    return parts.slice(loadoutIdx + 1).join("/");
  }
  
  // Fallback: return parent/basename
  const basename = path.basename(sourcePath);
  const parent = path.basename(path.dirname(sourcePath));
  return `${parent}/${basename}`;
}

/**
 * Extract artifact display name from a relative path.
 * 
 * Extracts human-friendly names:
 * - "skills/debugging/SKILL.md" → "debugging"
 * - "rules/my-rule.md" → "my-rule"
 * - "instructions/AGENTS.base.md" → "AGENTS.base.md"
 */
export function extractArtifactName(relativePath: string, kind: string): string {
  switch (kind) {
    case "skill": {
      const match = relativePath.match(/^skills\/([^/]+)/);
      return match ? match[1] : relativePath;
    }
    case "rule": {
      const match = relativePath.match(/^rules\/(.+)\.md$/);
      return match ? match[1] : relativePath;
    }
    case "agent": {
      const match = relativePath.match(/^agents\/(.+)\.md$/);
      return match ? match[1] : relativePath;
    }
    case "instruction": {
      const dirMatch = relativePath.match(/^instructions\/(AGENTS\.[^/]+\.md)$/);
      if (dirMatch) return dirMatch[1];
      const rootMatch = relativePath.match(/^([^/]+\.md)$/);
      return rootMatch ? rootMatch[1] : relativePath;
    }
    case "extension": {
      const match = relativePath.match(/^extensions\/(.+)$/);
      return match ? match[1] : relativePath;
    }
    default:
      return relativePath;
  }
}
