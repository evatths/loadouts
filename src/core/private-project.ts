import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { collectRootsWithSources, getBundledRoot, getGlobalRoot } from "./discovery.js";
import { listLoadouts, parseFrontmatter, parseRootConfig, sanitizeRuleFrontmatter } from "./config.js";
import { resolveLoadout } from "./resolve.js";
import type { LoadoutRoot, ResolvedLoadout, ResolvedItem } from "./types.js";

export interface RepoArtifact {
  kind: "instruction" | "skill" | "rule";
  repoPath: string;
  sourcePath: string;
}
export interface TeamLayer { id: string; name: string; items: RepoArtifact[] }
export interface PrivateProject {
  gitRoot: string;
  gitDir: string;
  projectRoot: string;
  projectKey: string;
  configPath: string;
  roots: LoadoutRoot[];
  layers: TeamLayer[];
}

const exec = promisify(execFile);
const details = new WeakMap<PrivateProject, { store: string; link: string; index: Map<string, number[]>; levels: Set<string> }>();
const storeBase = () => path.join(os.homedir(), ".config", "loadouts", "repos");
const inside = (root: string, file: string) => file === root || (!path.relative(root, file).startsWith(".." + path.sep) && path.relative(root, file) !== ".." && !path.isAbsolute(path.relative(root, file)));
const keyOf = (root: string, dir: string) => path.relative(root, dir).split(path.sep).join("/") || ".";
const safeName = (name: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && name !== "." && name !== "..";

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout;
}

async function gitPaths(cwd: string): Promise<{ root: string; dir: string; common: string } | null> {
  try {
    const lines = (await git(cwd, "rev-parse", "--path-format=absolute", "--show-toplevel", "--absolute-git-dir", "--git-common-dir")).trim().split("\n");
    if (lines.length !== 3) throw new Error("Unexpected git rev-parse output");
    return { root: fs.realpathSync(lines[0]), dir: lines[1], common: lines[2] };
  } catch (error) {
    if ((error as { code?: number }).code === 128) return null;
    throw error;
  }
}

// Resolve missing leaf components while refusing dangling symlinks.
function realMissing(file: string): string {
  try { return fs.realpathSync(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { fs.lstatSync(file); throw new Error(`Dangling symlink: ${file}`); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(realMissing(parent), path.basename(file));
  }
}

function storeTarget(link: string, allowDangling: boolean): string {
  if (!fs.lstatSync(link).isSymbolicLink()) throw new Error(`Private repo link is not a symlink: ${link}`);
  const store = path.resolve(path.dirname(link), fs.readlinkSync(link));
  const base = storeBase();
  if (path.dirname(store) !== base || !safeName(path.basename(store))) throw new Error(`Unsafe private repo target: ${store}`);
  if (!fs.existsSync(store)) {
    if (!allowDangling) throw new Error(`Private repo store is missing: ${store}. Clear the selection or restore the store.`);
  } else if (!fs.statSync(store).isDirectory() || fs.realpathSync(store) !== path.join(realMissing(base), path.basename(store))) {
    throw new Error(`Private repo store must be a directory under ${base}: ${store}`);
  }
  return store;
}

function hasLink(link: string): boolean {
  try { fs.lstatSync(link); return true; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export async function findPrivateProject(cwd: string, opts: { allowDangling?: boolean } = {}): Promise<PrivateProject | null> {
  const paths = await gitPaths(cwd);
  if (!paths) return null;
  const link = path.join(paths.common, "loadouts");
  if (!hasLink(link)) return null;
  const store = storeTarget(link, !!opts.allowDangling);
  const start = fs.realpathSync(cwd);
  if (!inside(paths.root, start)) throw new Error(`Outside Git root: ${cwd}`);
  const levels: string[] = [];
  for (let dir = start; ; dir = path.dirname(dir)) {
    levels.push(dir);
    if (dir === paths.root) break;
  }
  const specs: string[] = [];
  for (const dir of levels) {
    const prefix = keyOf(paths.root, dir) === "." ? "" : keyOf(paths.root, dir) + "/";
    const globPrefix = prefix.replace(/[\\*?\[]/g, "\\$&");
    specs.push(`:(literal)${prefix}AGENTS.md`, `:(literal)${prefix}CLAUDE.md`,
      `:(glob)${globPrefix}.loadouts/**`, `:(glob)${globPrefix}.cursor/rules/*.mdc`);
    for (const host of [".opencode", ".claude", ".agents"]) specs.push(`:(glob)${globPrefix}${host}/skills/*/SKILL.md`);
  }
  const index = new Map<string, number[]>();
  const output = await git(paths.root, "ls-files", "--stage", "-z", "--", ...specs);
  for (const entry of output.split("\0").filter(Boolean)) {
    const match = entry.match(/^\d+ [0-9a-f]+ ([0-3])\t([\s\S]+)$/);
    if (!match) throw new Error("Unexpected git index entry");
    const stages = index.get(match[2]) ?? [];
    stages.push(Number(match[1])); index.set(match[2], stages);
  }
  const roots: LoadoutRoot[] = [];
  const layers: TeamLayer[] = [];
  let projectRoot: string | undefined;
  const saved = opts.allowDangling && !fs.existsSync(store) ? selectionsAt(path.join(stateDirectory(paths.dir), "selection.json")) : undefined;
  for (const [depth, dir] of levels.entries()) {
    const key = keyOf(paths.root, dir);
    const prefix = key === "." ? "" : key + "/";
    const own = path.join(store, key, ".loadouts");
    const tracked = [...index.keys()].some((item) => item.startsWith(prefix + ".loadouts/"));
    const items: RepoArtifact[] = [];
    for (const file of index.keys()) {
      if (!file.startsWith(prefix)) continue;
      const local = file.slice(prefix.length);
      let kind: RepoArtifact["kind"] | undefined;
      let repoPath = file;
      if (local === "AGENTS.md" || local === "CLAUDE.md") kind = "instruction";
      else if (/^\.(?:opencode|claude|agents)\/skills\/[^/]+\/SKILL\.md$/.test(local)) {
        kind = "skill"; repoPath = file.slice(0, -"/SKILL.md".length);
      }
      if (kind) items.push({ kind, repoPath, sourcePath: path.join(paths.root, repoPath) });
    }
    if (fs.existsSync(own)) roots.push({ path: own, level: "project", depth });
    if (tracked) roots.push({ path: path.join(dir, ".loadouts"), level: "project", depth });
    if (!projectRoot && (saved ? Object.hasOwn(saved, key) : fs.existsSync(own) || tracked || items.length)) projectRoot = dir;
    if (items.length) layers.push({ id: `team:${key}`, name: path.basename(dir), items });
  }
  projectRoot ??= paths.root;
  const projectKey = keyOf(paths.root, projectRoot);
  const configPath = path.join(store, projectKey, ".loadouts");
  const seen = new Set(roots.map((root) => root.path));
  const append = (root: LoadoutRoot) => {
    for (const source of collectRootsWithSources(root, false, false).roots) {
      if (!seen.has(source.path)) { roots.push(source); seen.add(source.path); }
    }
  };
  for (const root of [...roots]) append(root);
  const global = getGlobalRoot(); if (global) append(global);
  const bundled = getBundledRoot(); if (bundled && !seen.has(bundled.path)) roots.push(bundled);
  const project: PrivateProject = { gitRoot: paths.root, gitDir: paths.dir, projectRoot, projectKey, configPath, roots, layers };
  details.set(project, { store, link, index, levels: new Set(levels.map((dir) => keyOf(paths.root, dir))) });
  return project;
}

export async function initPrivateProject(cwd: string, name?: string): Promise<PrivateProject> {
  const paths = await gitPaths(cwd);
  if (!paths) throw new Error("Private loadouts require a Git repository.");
  const chosen = name ?? path.basename(paths.root);
  if (!safeName(chosen)) throw new Error(`Unsafe private store name: ${chosen}`);
  const link = path.join(paths.common, "loadouts");
  const store = path.join(storeBase(), chosen);
  if (hasLink(link)) {
    const existing = storeTarget(link, false);
    if (name && existing !== store) throw new Error(`Repository already uses a different private store: ${existing}`);
  } else {
    fs.mkdirSync(storeBase(), { recursive: true });
    if (hasLink(store) && !name) throw new Error(`Private store already exists: ${store}. Use --name to reuse it explicitly.`);
    if (hasLink(store) && (!fs.statSync(store).isDirectory() || fs.lstatSync(store).isSymbolicLink())) throw new Error(`Unsafe private store: ${store}`);
    fs.mkdirSync(store, { recursive: true });
    fs.symlinkSync(store, link, "dir");
  }
  const selected = storeTarget(link, false);
  const dir = fs.realpathSync(cwd);
  if (!inside(paths.root, dir)) throw new Error(`Outside Git root: ${cwd}`);
  const own = path.join(selected, keyOf(paths.root, dir), ".loadouts");
  if (realMissing(own) !== path.join(realMissing(selected), keyOf(paths.root, dir), ".loadouts")) throw new Error(`Private author root escapes store: ${own}`);
  fs.mkdirSync(own, { recursive: true });
  return (await findPrivateProject(cwd))!;
}

export function privateAuthorRoot(project: PrivateProject, relativePath?: string): string {
  const data = details.get(project);
  if (!data || storeTarget(data.link, false) !== data.store) throw new Error("Private store is unavailable or changed.");
  const store = realMissing(data.store);
  const root = realMissing(project.configPath);
  if (root !== path.join(store, project.projectKey, ".loadouts")) throw new Error(`Private author root escapes store: ${project.configPath}`);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`No private author root at ${project.projectRoot}; run 'loadouts init --private' there first.`);
  if (relativePath !== undefined) {
    if (path.isAbsolute(relativePath)) throw new Error(`Unsafe private path: ${relativePath}`);
    const target = path.resolve(project.configPath, relativePath);
    if (!inside(project.configPath, target) || !inside(root, realMissing(target))) throw new Error(`Private path escapes author root: ${relativePath}`);
  }
  return project.configPath;
}

function stateDirectory(gitDir: string, create = false): string {
  const dir = path.join(fs.realpathSync(gitDir), "loadouts-state");
  if (create) {
    try { fs.mkdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  try {
    if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== dir) throw new Error(`Unsafe private selection directory: ${dir}`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT" || create) throw e;
  }
  return dir;
}
function selectionFile(project: PrivateProject): string { return path.join(stateDirectory(project.gitDir), "selection.json"); }
function selectionsAt(file: string): Record<string, string[]> {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((v) => !Array.isArray(v) || v.some((n) => typeof n !== "string"))) throw new Error(`Invalid private selection: ${file}`);
  return value as Record<string, string[]>;
}
export function readPrivateSelection(project: PrivateProject): string[] | undefined {
  const all = selectionsAt(selectionFile(project));
  return Object.hasOwn(all, project.projectKey) ? all[project.projectKey] : undefined;
}

export async function updatePrivateSelection(project: PrivateProject, change: (active: string[] | undefined) => string[] | undefined): Promise<void> {
  const dir = stateDirectory(project.gitDir, true), stat = fs.statSync(dir);
  const checkDir = () => {
    if (stateDirectory(project.gitDir) !== dir) throw new Error(`Private selection directory changed: ${dir}`);
    const current = fs.statSync(dir);
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error(`Private selection directory changed: ${dir}`);
  };
  const file = path.join(dir, "selection.json"), lock = file + ".lock";
  let handle: fs.promises.FileHandle | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    checkDir();
    try { handle = await fs.promises.open(lock, "wx"); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!handle) throw new Error(`Private selection is locked: ${lock}`);
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    checkDir();
    const all = selectionsAt(file);
    const next = change(Object.hasOwn(all, project.projectKey) ? all[project.projectKey] : undefined);
    if (next === undefined) delete all[project.projectKey];
    else if (!Array.isArray(next) || next.some((n) => typeof n !== "string")) throw new Error("Invalid private selection");
    else Object.defineProperty(all, project.projectKey, { value: next, enumerable: true, configurable: true, writable: true });
    checkDir();
    await fs.promises.writeFile(temp, JSON.stringify(all, null, 2) + "\n", { flag: "wx" });
    checkDir();
    await fs.promises.rename(temp, file);
  } finally {
    await handle.close();
    checkDir();
    await fs.promises.unlink(temp).catch(() => {});
    await fs.promises.unlink(lock);
  }
}

function trackedEntry(project: PrivateProject, file: string): boolean {
  const stages = details.get(project)?.index.get(keyOf(project.gitRoot, file));
  return !!stages && stages.length === 1 && stages[0] === 0;
}
function visibleDefinition(project: PrivateProject, root: LoadoutRoot, name: string): boolean {
  if (!safeName(name)) return false;
  if (!inside(project.gitRoot, root.path)) return true;
  const base = path.join(root.path, "loadouts", name);
  const file = fs.existsSync(base + ".yaml") ? base + ".yaml" : base + ".yml";
  return trackedEntry(project, file) && inside(project.gitRoot, fs.realpathSync(file));
}
export function privateNames(project: PrivateProject): string[] {
  return [...new Set(project.roots.flatMap((root) => listLoadouts(root.path).filter((name) => visibleDefinition(project, root, name))))];
}
export function teamLayerId(project: PrivateProject, name: string): string | undefined {
  const matches = project.layers.filter((layer) => name.startsWith("team:") ? layer.id === name : layer.name === name);
  if (matches.length && !name.startsWith("team:") && privateNames(project).includes(name)) return undefined;
  if (matches.length > 1) throw new Error(`Ambiguous team layer: ${name}; use its team: path.`);
  if (!matches.length && name.startsWith("team:")) throw new Error(`Unknown team layer: ${name}`);
  return matches[0]?.id;
}
export function teamLayerName(project: PrivateProject, layer: TeamLayer): string {
  return project.layers.filter((item) => item.name === layer.name).length > 1 || privateNames(project).includes(layer.name) ? layer.id : layer.name;
}

export function repoArtifact(project: PrivateProject, ref: string): RepoArtifact {
  if (!ref.startsWith("repo:")) throw new Error(`Expected repo: path: ${ref}`);
  const repoPath = ref.slice(5);
  if (!repoPath || path.posix.isAbsolute(repoPath) || repoPath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Invalid repo path: ${ref}`);
  const data = details.get(project);
  if (!data) throw new Error("Private project catalog unavailable");
  let kind: RepoArtifact["kind"];
  let entry = repoPath;
  if (/(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(repoPath)) kind = "instruction";
  else if (/(?:^|\/)\.(?:opencode|claude|agents)\/skills\/[^/]+$/.test(repoPath)) { kind = "skill"; entry += "/SKILL.md"; }
  else if (/(?:^|\/)\.cursor\/rules\/[^/]+\.mdc$/.test(repoPath)) kind = "rule";
  else throw new Error(`Unsupported repo artifact: ${ref}`);
  const level = kind === "instruction" ? path.posix.dirname(repoPath) : path.posix.dirname(path.posix.dirname(path.posix.dirname(repoPath)));
  if (!data.levels.has(level)) throw new Error(`Repo artifact is outside the current ancestor catalog: ${ref}. Run from that directory or one of its descendants.`);
  const stages = data.index.get(entry);
  if (!stages || stages.length !== 1 || stages[0] !== 0) throw new Error(`Untracked or unmerged repo artifact: ${ref}`);
  const target = path.join(project.gitRoot, repoPath);
  let sourcePath: string;
  try { sourcePath = fs.realpathSync(target); } catch { throw new Error(`Missing repo artifact: ${ref}`); }
  if (!inside(project.gitRoot, sourcePath)) throw new Error(`Repo artifact escapes Git root: ${ref}`);
  if (kind === "skill") {
    let entrypoint: string;
    try { entrypoint = fs.realpathSync(path.join(target, "SKILL.md")); } catch { throw new Error(`Missing skill entrypoint: ${ref}`); }
    if (!inside(project.gitRoot, entrypoint) || !fs.statSync(sourcePath).isDirectory()) throw new Error(`Invalid skill entrypoint: ${ref}`);
  } else if (!fs.statSync(sourcePath).isFile()) throw new Error(`Not a file: ${ref}`);
  if (kind === "rule" && parseFrontmatter(fs.readFileSync(sourcePath, "utf8")).frontmatter.alwaysApply !== true) throw new Error(`Cursor rule must have alwaysApply: true: ${ref}`);
  // Keep the tracked spelling for native winner attribution; callers can
  // canonicalize it for provenance after the target has passed containment.
  return { kind, repoPath, sourcePath: target };
}

export function resolvePrivateLoadouts(project: PrivateProject, names: string[], scope: "project" | "global" = "project"): ResolvedLoadout[] {
  const seen = new Set<string>();
  const global = scope === "global" ? getGlobalRoot() : null;
  const available = scope === "global" ? (global ? collectRootsWithSources(global, false, true).roots : []) : project.roots;
  return [...new Set(names)].filter((name) => !name.startsWith("team:")).map((name) => {
    if (!safeName(name)) throw new Error(`Invalid loadout name: ${name}`);
    const roots = available.filter((root) => !listLoadouts(root.path).includes(name) || visibleDefinition(project, root, name));
    const loadout = resolveLoadout(name, roots, parseRootConfig(global?.path ?? project.configPath), {
      onlyTool: "opencode",
      resolveRepo: (ref, tools): ResolvedItem => {
        const item = repoArtifact(project, ref);
        return { ...item, relativePath: ref, tools };
      },
    });
    loadout.items = loadout.items.filter((item) => {
      if (!["instruction", "rule", "skill"].includes(item.kind)) throw new Error(`Unsupported private artifact kind ${item.kind}: ${item.relativePath}`);
      if (!item.repoPath && inside(project.gitRoot, loadout.rootPath)) {
        const entry = item.kind === "skill" ? path.join(item.sourcePath, "SKILL.md") : item.sourcePath;
        if (!trackedEntry(project, entry) || !inside(project.gitRoot, fs.realpathSync(entry))) throw new Error(`Untracked, unmerged, or escaping artifact: ${item.relativePath}`);
      }
      if (item.kind === "rule" && !item.repoPath) {
        const frontmatter = parseFrontmatter(fs.readFileSync(item.sourcePath, "utf8")).frontmatter;
        if (frontmatter.alwaysApply === false || sanitizeRuleFrontmatter(frontmatter).activation !== "always") throw new Error(`Private rule must be always-on: ${item.relativePath}`);
      }
      if (item.kind === "skill" && (!fs.existsSync(path.join(item.sourcePath, "SKILL.md")) || !fs.statSync(path.join(item.sourcePath, "SKILL.md")).isFile())) throw new Error(`Missing skill entrypoint: ${item.relativePath}`);
      const identity = fs.realpathSync(item.sourcePath);
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    return loadout;
  });
}
