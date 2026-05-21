/**
 * Import Discovery — scan tool directories for existing configurations
 * that can be imported into loadout.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileExists, isDirectory, isSymlink, listFiles, walkDir } from "../lib/fs.js";
import { registry } from "./registry.js";
import type { Scope } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportableKind = string;

export interface DiscoveredArtifact {
  /** Artifact kind */
  kind: ImportableKind;
  /** Suggested display name */
  name: string;
  /** Absolute path to source file/directory */
  sourcePath: string;
  /** Display path relative to project root */
  displayPath: string;
  /** Which tool directory it came from */
  tool: string;
  /** File size in bytes (for files) or total size (for directories) */
  size: number;
  /** Last modification time */
  mtime: Date;
  /** Destination path in .loadouts/ */
  destPath: string;
}

export interface DiscoveryResult {
  /** All discovered artifacts */
  artifacts: DiscoveredArtifact[];
  /** Artifacts grouped by name that conflict */
  conflicts: Map<string, DiscoveredArtifact[]>;
  /** Any warnings during discovery */
  warnings: string[];
}

export interface DiscoveryOptions {
  /** Discovery scope */
  scope?: Scope;
  /** Filter to specific tools */
  tools?: string[];
  /** Filter to specific kinds */
  kinds?: ImportableKind[];
  /** Restrict discovery to one explicit source file or directory */
  sourcePath?: string;
  /** Path to .loadouts/ directory (to check for existing artifacts) */
  loadoutPath?: string;
}

interface TemplateMatch {
  matched: boolean;
  captures: Record<string, string>;
}

// Instruction file locations to check (in priority order)
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * Get file/directory size.
 */
function getSize(filePath: string): number {
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    let total = 0;
    const entries = fs.readdirSync(filePath, { withFileTypes: true });
    for (const entry of entries) {
      total += getSize(path.join(filePath, entry.name));
    }
    return total;
  }
  return stat.size;
}

/**
 * Get modification time.
 */
function getMtime(filePath: string): Date {
  return fs.statSync(filePath).mtime;
}

function readArtifactMetadata(filePath: string): { size: number; mtime: Date } | null {
  try {
    return {
      size: getSize(filePath),
      mtime: getMtime(filePath),
    };
  } catch {
    return null;
  }
}

/**
 * Convert Windows path separators to POSIX-style separators.
 */
function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/**
 * Escape string for safe regex inclusion.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Select the path template for the requested scope.
 */
function getScopeTemplate(
  mappingPath: string | { project: string; global: string },
  scope: Scope
): string {
  return typeof mappingPath === "string" ? mappingPath : mappingPath[scope];
}

/**
 * Resolve a tool base path to absolute for the current scope.
 */
function resolveAbsoluteBasePath(
  scanRoot: string,
  basePath: string
): string {
  return path.isAbsolute(basePath) ? basePath : path.join(scanRoot, basePath);
}

/**
 * Format a path for display relative to scan root when possible.
 */
function toDisplayPath(scanRoot: string, absolutePath: string): string {
  const rel = path.relative(scanRoot, absolutePath);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return toPosix(rel);
  }

  const home = os.homedir();
  if (absolutePath === home) return "~";
  if (absolutePath.startsWith(`${home}${path.sep}`)) {
    return `~/${toPosix(path.relative(home, absolutePath))}`;
  }

  return toPosix(absolutePath);
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function matchesSourcePath(artifact: DiscoveredArtifact, sourcePath: string): boolean {
  if (artifact.kind === "skill" && isPathWithin(artifact.sourcePath, sourcePath)) {
    return true;
  }

  return isPathWithin(sourcePath, artifact.sourcePath) || artifact.sourcePath === sourcePath;
}

function sourceAllowsKind(kindId: string, kinds: ImportableKind[] | undefined): boolean {
  return !kinds || kinds.length === 0 || kinds.includes(kindId);
}

function buildSourceArtifact(
  scanRoot: string,
  kind: ImportableKind,
  sourcePath: string,
  destPath: string,
  name: string
): DiscoveredArtifact | null {
  const metadata = readArtifactMetadata(sourcePath);
  if (!metadata) return null;

  return {
    kind,
    name,
    sourcePath,
    displayPath: toDisplayPath(scanRoot, sourcePath),
    tool: "source",
    size: metadata.size,
    mtime: metadata.mtime,
    destPath,
  };
}

function buildRuleSourceArtifact(scanRoot: string, sourcePath: string): DiscoveredArtifact | null {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext !== ".md" && ext !== ".mdc") return null;

  const stem = path.basename(sourcePath, ext);
  if (!stem || stem === "AGENTS" || stem === "CLAUDE") return null;

  return buildSourceArtifact(scanRoot, "rule", sourcePath, `rules/${stem}.md`, stem);
}

function buildInstructionSourceArtifact(scanRoot: string, sourcePath: string): DiscoveredArtifact | null {
  const basename = path.basename(sourcePath);
  if (basename !== "AGENTS.md" && basename !== "CLAUDE.md" && !/^AGENTS\.[^.]+\.md$/.test(basename)) {
    return null;
  }

  return buildSourceArtifact(
    scanRoot,
    "instruction",
    sourcePath,
    "instructions/AGENTS.base.md",
    "AGENTS.md"
  );
}

function buildSkillSourceArtifact(scanRoot: string, skillDir: string): DiscoveredArtifact | null {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fileExists(skillMdPath)) return null;

  const name = path.basename(skillDir);
  return buildSourceArtifact(scanRoot, "skill", skillDir, `skills/${name}`, name);
}

function discoverDirectSourceArtifacts(
  scanRoot: string,
  sourcePath: string,
  kinds: ImportableKind[] | undefined
): DiscoveredArtifact[] {
  const artifacts: DiscoveredArtifact[] = [];

  if (!fileExists(sourcePath)) return artifacts;

  if (!isDirectory(sourcePath)) {
    if (sourceAllowsKind("instruction", kinds)) {
      const instruction = buildInstructionSourceArtifact(scanRoot, sourcePath);
      if (instruction) artifacts.push(instruction);
    }

    if (sourceAllowsKind("skill", kinds) && path.basename(sourcePath) === "SKILL.md") {
      const skill = buildSkillSourceArtifact(scanRoot, path.dirname(sourcePath));
      if (skill) artifacts.push(skill);
    }

    if (sourceAllowsKind("rule", kinds)) {
      const rule = buildRuleSourceArtifact(scanRoot, sourcePath);
      if (rule) artifacts.push(rule);
    }

    return artifacts;
  }

  if (sourceAllowsKind("skill", kinds)) {
    const directSkill = buildSkillSourceArtifact(scanRoot, sourcePath);
    if (directSkill) artifacts.push(directSkill);
  }

  const basename = path.basename(sourcePath);

  const rulesRoot = basename === "rules" ? sourcePath : path.join(sourcePath, "rules");
  if (sourceAllowsKind("rule", kinds) && isDirectory(rulesRoot)) {
    for (const rel of walkDir(rulesRoot)) {
      const rule = buildRuleSourceArtifact(scanRoot, path.join(rulesRoot, rel));
      if (rule) artifacts.push(rule);
    }
  }

  const skillsRoot = basename === "skills" ? sourcePath : path.join(sourcePath, "skills");
  if (sourceAllowsKind("skill", kinds) && isDirectory(skillsRoot)) {
    for (const entry of listFiles(skillsRoot)) {
      const skillDir = path.join(skillsRoot, entry);
      if (!isDirectory(skillDir)) continue;

      const skill = buildSkillSourceArtifact(scanRoot, skillDir);
      if (skill) artifacts.push(skill);
    }
  }

  const instructionsRoot = basename === "instructions" ? sourcePath : path.join(sourcePath, "instructions");
  if (sourceAllowsKind("instruction", kinds) && isDirectory(instructionsRoot)) {
    for (const rel of walkDir(instructionsRoot)) {
      const instruction = buildInstructionSourceArtifact(scanRoot, path.join(instructionsRoot, rel));
      if (instruction) artifacts.push(instruction);
    }
  }

  return artifacts;
}

function dedupeArtifacts(artifacts: DiscoveredArtifact[]): DiscoveredArtifact[] {
  const seen = new Set<string>();
  const deduped: DiscoveredArtifact[] = [];

  for (const artifact of artifacts) {
    const key = `${artifact.kind}:${artifact.sourcePath}:${artifact.destPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(artifact);
  }

  return deduped;
}

/**
 * Build a regex matcher for a concrete template path.
 * Supported tokens: {base} {home} {stem} {ext} {name} {relative} {kind}
 */
function matchTemplatePath(templatePath: string, actualPath: string): TemplateMatch {
  const captures: Record<string, string> = {};
  const tokens: string[] = [];

  let pattern = "";
  for (let i = 0; i < templatePath.length; i += 1) {
    const ch = templatePath[i];
    if (ch === "{") {
      const end = templatePath.indexOf("}", i + 1);
      if (end === -1) {
        pattern += escapeRegex(ch);
        continue;
      }
      const token = templatePath.slice(i + 1, end);
      tokens.push(token);
      switch (token) {
        case "stem":
        case "name":
        case "kind":
          pattern += "([^/]+)";
          break;
        case "ext":
          pattern += "([^/]*)";
          break;
        case "relative":
          pattern += "(.+)";
          break;
        case "base":
        case "home":
          pattern += "(.+)";
          break;
        default:
          pattern += "(.+)";
          break;
      }
      i = end;
      continue;
    }
    pattern += escapeRegex(ch);
  }

  const regex = new RegExp(`^${pattern}$`);
  const match = actualPath.match(regex);
  if (!match) return { matched: false, captures };

  for (let i = 0; i < tokens.length; i += 1) {
    captures[tokens[i]] = match[i + 1] ?? "";
  }

  return { matched: true, captures };
}

/**
 * Check if a file at project root is managed by loadout.
 * A file is managed if it's a symlink pointing into .loadouts/.
 */
function isManagedByLoadout(filePath: string, loadoutPath: string | undefined): boolean {
  if (!loadoutPath) return false;
  if (!isSymlink(filePath)) return false;

  try {
    const target = fs.readlinkSync(filePath);
    const absoluteTarget = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(filePath), target);
    return absoluteTarget.startsWith(loadoutPath);
  } catch {
    return false;
  }
}

/**
 * Check if a file is the auto-generated CLAUDE.md wrapper.
 */
function isClaudeWrapper(filePath: string): boolean {
  if (!fileExists(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.includes("auto-generated by Loadout") || content.includes("auto-generated by Loadouts");
  } catch {
    return false;
  }
}

/**
 * Infer destination path for a discovered artifact.
 *
 * For built-ins we preserve canonical layout.
 * For custom/future kinds we try several heuristics and keep whichever
 * path is accepted by the kind's detect() predicate.
 */
function inferDestPath(
  kindId: string,
  toolName: string,
  strippedTargetPath: string,
  captures: Record<string, string>
): string | null {
  const kind = registry.getKind(kindId);
  if (!kind) return null;

  const stem = captures.stem || captures.name || path.basename(strippedTargetPath, path.extname(strippedTargetPath));
  const ext = captures.ext || path.extname(strippedTargetPath);

  // Canonical built-ins.
  if (kindId === "instruction") {
    return "instructions/AGENTS.base.md";
  }
  if (kindId === "rule") {
    return `rules/${stem}.md`;
  }

  const candidates = [
    strippedTargetPath,
    `${toolName}/${strippedTargetPath}`,
    `${kindId}/${strippedTargetPath}`,
    `${kindId.replace(/-/g, "/")}/${strippedTargetPath}`,
    `${kindId}/${stem}${ext}`,
    `${kindId.replace(/-/g, "/")}/${stem}${ext}`,
  ];

  for (const candidate of candidates) {
    const rel = toPosix(candidate).replace(/^\/+/, "");
    if (kind.detect(rel)) {
      return rel;
    }
  }

  return null;
}

/**
 * Check whether a given destination path already exists in .loadouts/.
 */
function artifactExistsInLoadout(
  loadoutPath: string,
  artifact: DiscoveredArtifact
): boolean {
  if (artifact.kind === "instruction") {
    return false;
  }

  const kind = registry.getKind(artifact.kind);
  if (!kind) return false;

  const destPath = path.join(loadoutPath, artifact.destPath);
  return kind.layout === "dir" ? isDirectory(destPath) : fileExists(destPath);
}

/**
 * Discover instruction files at project root.
 * Only discovers files that are NOT managed by loadout.
 */
function discoverInstructions(
  scanRoot: string,
  loadoutPath: string | undefined
): DiscoveredArtifact[] {
  const kind = registry.getKind("instruction");
  if (!kind) return [];

  const artifacts: DiscoveredArtifact[] = [];

  for (const filename of INSTRUCTION_FILES) {
    const filePath = path.join(scanRoot, filename);
    if (!fileExists(filePath)) continue;

    if (isManagedByLoadout(filePath, loadoutPath)) continue;
    if (filename === "CLAUDE.md" && isClaudeWrapper(filePath)) continue;

    const metadata = readArtifactMetadata(filePath);
    if (!metadata) continue;

    artifacts.push({
      kind: "instruction",
      name: "AGENTS.md",
      sourcePath: filePath,
      displayPath: filename,
      tool: "project-root",
      size: metadata.size,
      mtime: metadata.mtime,
      destPath: "instructions/AGENTS.base.md",
    });
  }

  return artifacts;
}

/**
 * Discover artifacts for one (tool, kind) pair by matching tool target templates.
 */
function discoverForToolKind(
  scanRoot: string,
  scope: Scope,
  toolName: string,
  kindId: string,
  warnings: string[]
): DiscoveredArtifact[] {
  // Instruction files are discovered centrally at project root to avoid
  // duplicate detection across tools that map to AGENTS.md / CLAUDE.md.
  if (kindId === "instruction") return [];

  const tool = registry.getTool(toolName);
  const kind = registry.getKind(kindId);
  if (!tool || !kind) return [];

  const mapping = registry.resolveMapping(toolName, kindId);
  if (!mapping) return [];

  const template = getScopeTemplate(mapping.path, scope);
  const absoluteBasePath = resolveAbsoluteBasePath(scanRoot, tool.basePath[scope]);
  const concreteTemplate = toPosix(template)
    .replaceAll("{base}", toPosix(absoluteBasePath))
    .replaceAll("{home}", toPosix(os.homedir()));

  const parentTemplate = path.posix.dirname(concreteTemplate);
  const leafTemplate = path.posix.basename(concreteTemplate);
  const templateIsAbsolute = path.posix.isAbsolute(concreteTemplate);

  // If parent path still has unresolved tokens, we cannot reliably scan.
  if (/{[^}]+}/.test(parentTemplate)) {
    warnings.push(
      `Skipped ${toolName}:${kindId} import scan (unsupported template parent: ${template})`
    );
    return [];
  }

  const parentAbs = templateIsAbsolute
    ? parentTemplate
    : path.join(scanRoot, parentTemplate);
  if (!isDirectory(parentAbs)) return [];

  let candidateAbsPaths: string[] = [];

  if (kind.layout === "dir") {
    // Prefer one-level dir scanning for templates like .../{name}.
    if (leafTemplate === "{name}" || leafTemplate === "{stem}") {
      candidateAbsPaths = listFiles(parentAbs)
        .map((entry) => path.join(parentAbs, entry))
        .filter((absolutePath) => isDirectory(absolutePath));
    } else if (!/{[^}]+}/.test(leafTemplate)) {
      const absolutePath = path.join(parentAbs, leafTemplate);
      if (isDirectory(absolutePath)) {
        candidateAbsPaths = [absolutePath];
      }
    }
  } else {
    if (/{relative}/.test(template)) {
      candidateAbsPaths = walkDir(parentAbs).map((entry) => path.join(parentAbs, entry));
    } else if (!/{[^}]+}/.test(leafTemplate)) {
      const absolutePath = path.join(parentAbs, leafTemplate);
      if (fileExists(absolutePath)) {
        candidateAbsPaths = [absolutePath];
      }
    } else {
      candidateAbsPaths = listFiles(parentAbs)
        .map((entry) => path.join(parentAbs, entry))
        .filter((absolutePath) => fileExists(absolutePath));
    }
  }

  const artifacts: DiscoveredArtifact[] = [];

  for (const sourcePath of candidateAbsPaths) {
    const sourcePathPosix = toPosix(sourcePath);
    const matchPath = templateIsAbsolute
      ? sourcePathPosix
      : toPosix(path.relative(scanRoot, sourcePath));
    const match = matchTemplatePath(concreteTemplate, matchPath);
    if (!match.matched) continue;

    // Skip tool directories symlinked to another tool to avoid duplicates.
    if (kind.layout === "dir" && isSymlink(sourcePath)) {
      continue;
    }

    const basePrefix = `${toPosix(absoluteBasePath)}/`;
    const stripped = sourcePathPosix.startsWith(basePrefix)
      ? sourcePathPosix.slice(basePrefix.length)
      : matchPath;

    const destPath = inferDestPath(kindId, toolName, stripped, match.captures);
    if (!destPath) {
      warnings.push(
        `Skipped ${toolName}:${kindId} artifact (cannot infer loadout path for ${matchPath})`
      );
      continue;
    }

    const metadata = readArtifactMetadata(sourcePath);
    if (!metadata) {
      warnings.push(
        `Skipped ${toolName}:${kindId} artifact (unreadable path: ${toDisplayPath(scanRoot, sourcePath)})`
      );
      continue;
    }

    const name = kind.layout === "dir"
      ? path.basename(destPath)
      : path.basename(destPath, path.extname(destPath));

    artifacts.push({
      kind: kindId,
      name,
      sourcePath,
      displayPath: toDisplayPath(scanRoot, sourcePath),
      tool: toolName,
      size: metadata.size,
      mtime: metadata.mtime,
      destPath,
    });
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Public discovery API
// ---------------------------------------------------------------------------

/**
 * Discover all importable artifacts in a project.
 */
export function discoverImportableArtifacts(
  scanRoot: string,
  options: DiscoveryOptions = {}
): DiscoveryResult {
  const artifacts: DiscoveredArtifact[] = [];
  const warnings: string[] = [];
  const { scope = "project", tools, kinds, loadoutPath } = options;
  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : undefined;

  const allTools = registry.allToolNames();
  const toolsToScan = tools
    ? allTools.filter((tool) => tools.includes(tool))
    : allTools;

  const allKinds = registry.allKinds().map((kind) => kind.id);
  const kindsToScan = kinds && kinds.length > 0
    ? allKinds.filter((kind) => kinds.includes(kind))
    : allKinds;

  for (const toolName of toolsToScan) {
    for (const kindId of kindsToScan) {
      artifacts.push(...discoverForToolKind(scanRoot, scope, toolName, kindId, warnings));
    }
  }

  // Keep root-level instruction import behavior for unmanaged AGENTS/CLAUDE files.
  if (!kinds || kinds.length === 0 || kinds.includes("instruction")) {
    artifacts.push(...discoverInstructions(scanRoot, loadoutPath));
  }

  if (sourcePath) {
    artifacts.push(...discoverDirectSourceArtifacts(scanRoot, sourcePath, kinds));
  }

  // Filter out artifacts already present in .loadouts/.
  const existingFilteredArtifacts = loadoutPath
    ? artifacts.filter((artifact) => !artifactExistsInLoadout(loadoutPath, artifact))
    : artifacts;

  const sourceFilteredArtifacts = sourcePath
    ? existingFilteredArtifacts.filter((artifact) => matchesSourcePath(artifact, sourcePath))
    : existingFilteredArtifacts;

  const filteredArtifacts = dedupeArtifacts(sourceFilteredArtifacts);

  // Detect conflicts by canonical destination path.
  const byDest = new Map<string, DiscoveredArtifact[]>();
  for (const artifact of filteredArtifacts) {
    const key = `${artifact.kind}:${artifact.destPath}`;
    const existing = byDest.get(key) ?? [];
    existing.push(artifact);
    byDest.set(key, existing);
  }

  const conflicts = new Map<string, DiscoveredArtifact[]>();
  for (const [key, items] of byDest) {
    if (items.length > 1) {
      conflicts.set(key, items);
    }
  }

  return { artifacts: filteredArtifacts, conflicts, warnings };
}

/**
 * Group artifacts by kind for display.
 */
export function groupByKind(
  artifacts: DiscoveredArtifact[]
): Record<string, DiscoveredArtifact[]> {
  const groups: Record<string, DiscoveredArtifact[]> = {};
  for (const artifact of artifacts) {
    groups[artifact.kind] ??= [];
    groups[artifact.kind].push(artifact);
  }
  return groups;
}

/**
 * Format file size for display.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format relative time for display.
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
