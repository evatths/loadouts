import * as path from "node:path";
import * as yaml from "yaml";
import { getContext } from "../../core/discovery.js";
import { parseLoadoutDefinition } from "../../core/config.js";
import { registry } from "../../core/registry.js";
import { requireScopeForName, type ScopeFlags } from "../../core/scope.js";
import type { CommandContext, LoadoutDefinition, LoadoutInclude } from "../../core/types.js";
import { fileExists, isDirectory, writeFile } from "../../lib/fs.js";

const LOADOUTS_DIR = "loadouts";

export interface IncludeInput {
  path: string;
  tools?: string[];
}

export interface IncludeMutationResult {
  changed: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface LoadoutMutationTarget {
  ctx: CommandContext;
  loadoutPath: string;
  definition: LoadoutDefinition;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

export function includePathOf(entry: LoadoutInclude): string {
  return typeof entry === "string" ? entry : entry.path;
}

export function normalizeIncludePath(raw: string, loadoutRoot?: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Artifact path cannot be empty.");
  }

  let includePath: string;
  if (path.isAbsolute(trimmed)) {
    if (!loadoutRoot) {
      throw new Error(`Absolute artifact path requires a loadout root: ${trimmed}`);
    }

    const resolvedRoot = path.resolve(loadoutRoot);
    const resolvedPath = path.resolve(trimmed);
    if (!isPathWithin(resolvedRoot, resolvedPath)) {
      throw new Error(`Artifact path must be inside ${loadoutRoot}: ${trimmed}`);
    }

    includePath = path.relative(resolvedRoot, resolvedPath);
  } else {
    includePath = trimmed;
  }

  includePath = toPosix(includePath).replace(/^\.\//, "");
  if (includePath === ".loadouts") {
    throw new Error("Artifact path must point to an artifact inside .loadouts.");
  }
  if (includePath.startsWith(".loadouts/")) {
    includePath = includePath.slice(".loadouts/".length);
  }

  includePath = path.posix.normalize(includePath);
  if (includePath === "." || includePath === "" || includePath === ".." || includePath.startsWith("../")) {
    throw new Error(`Artifact path cannot escape .loadouts: ${raw}`);
  }

  return includePath;
}

export function hasInclude(definition: LoadoutDefinition, includePath: string): boolean {
  return definition.include.some((entry) => includePathOf(entry) === includePath);
}

export function addIncludes(
  definition: LoadoutDefinition,
  includes: IncludeInput[]
): IncludeMutationResult {
  const result: IncludeMutationResult = { changed: [], skipped: [] };

  for (const include of includes) {
    if (hasInclude(definition, include.path)) {
      result.skipped.push({ path: include.path, reason: "already included" });
      continue;
    }

    definition.include.push(include.tools ? { path: include.path, tools: include.tools } : include.path);
    result.changed.push(include.path);
  }

  return result;
}

export function removeIncludes(
  definition: LoadoutDefinition,
  includePaths: string[]
): IncludeMutationResult {
  const result: IncludeMutationResult = { changed: [], skipped: [] };

  for (const includePath of includePaths) {
    const before = definition.include.length;
    definition.include = definition.include.filter((entry) => includePathOf(entry) !== includePath);

    if (definition.include.length === before) {
      result.skipped.push({ path: includePath, reason: "not included" });
    } else {
      result.changed.push(includePath);
    }
  }

  return result;
}

export function parseToolsOption(raw?: string): string[] | undefined {
  if (!raw) return undefined;

  const tools = [...new Set(raw.split(",").map((tool) => tool.trim()).filter(Boolean))];
  if (tools.length === 0) {
    throw new Error("--tools requires at least one tool name.");
  }

  for (const tool of tools) {
    if (!registry.getTool(tool)) {
      throw new Error(`Unknown tool: ${tool}`);
    }
  }

  return tools;
}

export function findLoadoutPath(loadoutRoot: string, name: string): string | null {
  const yamlPath = path.join(loadoutRoot, LOADOUTS_DIR, `${name}.yaml`);
  const ymlPath = path.join(loadoutRoot, LOADOUTS_DIR, `${name}.yml`);

  if (fileExists(yamlPath)) return yamlPath;
  if (fileExists(ymlPath)) return ymlPath;
  return null;
}

export async function resolveLoadoutMutationTarget(
  name: string,
  options: ScopeFlags,
  cwd: string = process.cwd()
): Promise<LoadoutMutationTarget> {
  if (options.local && options.global) {
    throw new Error("Use either --local or --global, not both.");
  }

  const scope = await requireScopeForName(name, options, cwd);
  const ctx = await getContext(scope, cwd);
  const loadoutPath = findLoadoutPath(ctx.configPath, name);

  if (!loadoutPath) {
    throw new Error(`Loadout '${name}' not found in ${scope} scope.`);
  }

  return {
    ctx,
    loadoutPath,
    definition: parseLoadoutDefinition(loadoutPath),
  };
}

export function normalizeAndValidateArtifact(
  raw: string,
  loadoutRoot: string
): IncludeInput {
  const includePath = normalizeIncludePath(raw, loadoutRoot);
  const kind = registry.allKinds().find((candidate) => candidate.detect(includePath));
  if (!kind) {
    throw new Error(`Unsupported artifact path: ${includePath}`);
  }

  const artifactPath = path.join(loadoutRoot, includePath);
  const exists = kind.layout === "dir"
    ? isDirectory(artifactPath)
    : fileExists(artifactPath) && !isDirectory(artifactPath);

  if (!exists) {
    throw new Error(`Artifact not found: ${includePath}`);
  }

  return { path: includePath };
}

export function writeLoadoutDefinition(loadoutPath: string, definition: LoadoutDefinition): void {
  writeFile(loadoutPath, yaml.stringify(definition));
}
