import { Command } from "commander";
import { findPrivateProject, privateAuthorRoot, readPrivateSelection, updatePrivateSelection, teamLayerId, resolvePrivateLoadouts, privateNames, teamLayerName, repoArtifact } from "../../core/private-project.js";
import { computeActivateSet, computeDeactivateSet } from "./policy.js";
import { heading, log } from "../../lib/output.js";
import type { ScopeFlags } from "../../core/scope.js";
import { isDirectory } from "../../lib/fs.js";
import * as path from "node:path";
import { getContext, getGlobalRoot } from "../../core/discovery.js";
import { calculateColumnWidths, getToolColumns, renderHeader, renderSeparator } from "../../lib/artifact-table.js";

export async function privateProject(options: ScopeFlags = {}, cwd = process.cwd(), allowDangling = false) {
  return options.global ? undefined : await findPrivateProject(cwd, { allowDangling });
}

export async function globalInspectionCwd(options: ScopeFlags, cwd: string): Promise<string> {
  return options.global && await findPrivateProject(cwd, { allowDangling: true }) ? getGlobalRoot()?.path ?? cwd : cwd;
}

export function authorName(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error(`Invalid name: ${name}`);
}

export async function authorRoot(options: ScopeFlags = {}, cwd = process.cwd()) {
  const project = await privateProject(options, cwd);
  if (!project) return undefined;
  const rootPath = privateAuthorRoot(project);
  if (!isDirectory(rootPath)) throw new Error("Run 'loadouts init --private' at this project level before authoring.");
  return { project, rootPath };
}

export function authorPath(project: NonNullable<Awaited<ReturnType<typeof privateProject>>>, relative: string): string {
  return path.join(privateAuthorRoot(project, relative), relative);
}

// Check canonical Commander command names, not the spelling or aliases supplied by the user.
export function privatePolicy(cli: Command): void {
  cli.hook("preAction", async (_root, command) => {
    const options = command.opts();
    const parent = command.parent?.name();
    const name = parent && parent !== "loadouts" ? `${parent} ${command.name()}` : command.name();
    if (name === "init" && options.private) {
      if (options.global || options.force) throw new Error("--private cannot be combined with --global or --force.");
      return;
    }
    const project = await findPrivateProject(process.cwd(), { allowDangling: true });
    if (!project) return;
    if ([options.local, options.global, options.all].filter(Boolean).length > 1) throw new Error("Use only one scope flag.");
    const imports = name === "install" || (name.endsWith(" import") && !options.listBuiltins);
    const unsupported = ["init", "fallback", "migrate", "sanitize", "remove", "edit", "rule edit", "rule remove", "skill edit", "skill remove"].includes(name)
      || (name === "doctor" && options.fix) || (name === "update" && !options.check);
    const mutators = ["activate", "deactivate", "clear", "sync", "create", "add-to", "remove-from", "rule add", "skill add", "instructions init", "instructions edit"].includes(name);
    if (imports || (unsupported && !options.global) || (mutators && options.all)) {
      throw new Error(`${name} is not supported in an enrolled private repo. Run it outside the repo${imports ? " (even for --global imports)" : " or use --global where available"}.`);
    }
  });
}

export async function privateSelection(action: "activate" | "deactivate" | "sync", names: string[], options: ScopeFlags & { dryRun?: boolean }): Promise<boolean> {
  const project = await privateProject(options);
  if (!project) return false;
  const canonical = await Promise.all(names.map(async (name) => (await teamLayerId(project, name)) ?? name));
  const validate = (ids: string[]) => {
    for (const id of ids.filter((item) => item.startsWith("team:"))) {
      teamLayerId(project, id);
      for (const item of project.layers.find((layer) => layer.id === id)!.items) repoArtifact(project, `repo:${item.repoPath}`);
    }
    const personal = ids.filter((id) => !project.layers.some((layer) => layer.id === id));
    resolvePrivateLoadouts(project, personal);
  };
  if (action !== "deactivate") validate(canonical);
  if (action === "sync") {
    validate((await readPrivateSelection(project)) ?? []);
    log.success("Private selection validated (no files rendered).");
    return true;
  }
  const compute = (current: string[] | undefined) => {
    const initial = current ?? project.layers.map((layer) => layer.id);
    const result = action === "activate" ? computeActivateSet(initial, canonical) : computeDeactivateSet(initial, canonical);
    const next = result.earlyExit ? initial : result.targets;
    validate(next);
    return next;
  };
  if (options.dryRun) log.info(`Would select: ${compute(await readPrivateSelection(project)).join(", ") || "(none)"}`);
  else {
    await updatePrivateSelection(project, compute);
    log.success(`${action === "activate" ? "Activated" : "Deactivated"}: ${canonical.join(", ")}`);
  }
  return true;
}

export async function inspectPrivate(kind: "list" | "info" | "status", name: string | undefined, options: ScopeFlags & { json?: boolean }): Promise<boolean> {
  const project = await privateProject(options);
  if (!project) return false;
  const saved = await readPrivateSelection(project);
  const active = saved ?? project.layers.map((layer) => layer.id);
  const personal = await privateNames(project);
  const layers = await Promise.all(project.layers.map(async (layer) => ({ ...layer, display: await teamLayerName(project, layer) })));
  const id = name ? (await teamLayerId(project, name)) ?? name : undefined;
  const layer = layers.find((item) => item.id === id);
  if (kind === "info" && options.json && !name) throw new Error("Loadout name required for --json.");
  if (kind === "info" && id && !layer && !personal.includes(id)) throw new Error(`Loadout not found: ${name}`);
  const resolved = kind === "info" && id && !layer ? await resolvePrivateLoadouts(project, [id]) : [];
  const items = layer ? layer.items.map((item) => ({ kind: item.kind, relativePath: `repo:${item.repoPath}`, tools: ["opencode"] }))
    : resolved.flatMap((loadout) => loadout.items.map((item) => ({ kind: item.kind, relativePath: item.relativePath, tools: item.tools })));
  const rows = [...personal.map((item) => ({ name: item, id: item, active: active.includes(item) })), ...layers.map((item) => ({ name: item.display, id: item.id, active: active.includes(item.id) }))];
  const includeGlobal = !options.local && !!getGlobalRoot() && (kind !== "info" || !!options.all);
  const globalCwd = getGlobalRoot()?.path ?? process.cwd();
  const globalList = includeGlobal && kind === "list" ? (await import("./list.js")).getListJson({ global: true }, globalCwd) : undefined;
  const globalStatus = includeGlobal && kind === "status" ? (await import("./status.js")).getStatusJson([await getContext("global")], globalCwd) : undefined;
  const globalRows = await globalList;
  const globalState = await globalStatus;
  let globalInfo: unknown;
  if (includeGlobal && kind === "info" && options.json && name) {
    try { globalInfo = await (await import("./info.js")).getInfoJson(name, { global: true }, globalCwd); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("not found")) throw error; }
  }
  if (options.json) {
    const loadouts = rows.map((row) => {
      const team = layers.find((item) => item.id === row.id);
      let artifacts: Array<{ kind: string }> = team?.items ?? [];
      let broken = false;
      if (!team) {
        try { artifacts = resolvePrivateLoadouts(project, [row.id]).flatMap((item) => item.items); }
        catch { broken = true; }
      }
      const count = (kind: string) => artifacts.filter((item) => item.kind === kind).length;
      return { ...row, scope: "project", status: broken ? "broken" : row.active ? "active" : "available", tools: ["opencode"], counts: { rules: count("rule"), skills: count("skill"), instructions: count("instruction"), extensions: count("extension") }, refs: team?.items.map((item) => `repo:${item.repoPath}`) };
    });
    console.log(JSON.stringify(kind === "status" ? { active: [...active, ...(globalState?.active ?? [])], drift: globalState?.drift ?? [], selection: saved ?? null } : kind === "info" ? { name, id, items, global: globalInfo } : { loadouts: [...loadouts, ...(globalRows?.loadouts ?? [])] }, null, 2));
  } else if (kind === "info" && id) {
    heading(`Loadout: ${name}${layer && layer.id !== name ? ` (${layer.id})` : ""}`);
    if (!items.length) log.dim("  No artifacts.");
    else {
      const widths = calculateColumnWidths(items.map((item) => ({ ...item, name: item.relativePath })), 4, Math.max(35, ...items.map((item) => item.relativePath.length)));
      const columns = getToolColumns([...new Set(items.flatMap((item) => item.tools))].sort());
      renderHeader(widths.kindWidth, widths.nameWidth, columns);
      renderSeparator(widths.kindWidth, widths.nameWidth, columns);
      for (const item of items) console.log(`  ${item.kind.padEnd(widths.kindWidth)}  ${item.relativePath.padEnd(widths.nameWidth)}  ${columns.map((col) => (item.tools.includes(col.tool) ? "✓" : "—").padEnd(col.width)).join("  ")}`);
    }
  } else {
    heading(kind === "status" ? "Private selection" : "Available private and team loadouts");
    if (kind === "status" && !saved) log.dim("  Native defaults (no saved selection)");
    for (const row of rows.filter((row) => kind === "list" || row.active)) {
      console.log(`  ${row.active ? "▸" : " "} ${row.name}${row.name !== row.id ? ` (${row.id})` : ""}`);
      if (kind !== "list") for (const item of layers.find((layer) => layer.id === row.id)?.items ?? []) console.log(`      ${item.kind}: repo:${item.repoPath}`);
    }
    if (kind === "status") log.dim("  Selection only; session delivery is not verified here.");
    if (globalRows) for (const row of globalRows.loadouts) console.log(`  ${row.status === "active" ? "▸" : " "} ${row.name} •`);
    if (globalState) for (const item of globalState.active) console.log(`  ▸ ${item} •`);
  }
  if (includeGlobal && kind === "info" && !options.json) await (await import("./info.js")).executeInfo([await getContext("global")], name);
  return true;
}
