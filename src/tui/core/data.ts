import * as path from "node:path";
import * as os from "node:os";
import { listLoadouts, parseLoadoutDefinition, parseRootConfig } from "../../core/config.js";
import {
  collectCatalogRoots,
  collectRootsWithSources,
  type CatalogOwner,
  type CatalogRootEntry,
} from "../../core/discovery.js";
import { loadState, detectDrift, type DriftResult } from "../../core/manifest.js";
import { planRender } from "../../core/render.js";
import { resolveLoadout } from "../../core/resolve.js";
import type { LoadoutRoot, Scope, Tool } from "../../core/types.js";
import { getArtifactName, sortArtifacts } from "../../lib/artifact-table.js";
import { fileExists } from "../../lib/fs.js";
import type { ActivationMode } from "./model.js";

export type LoadoutStatus = "active" | "available" | "drift" | "broken";

export interface ArtifactSlot {
  kind: string;
  name: string;
  relativePath: string;
  tools: string[];
}

export interface LoadoutCounts {
  rules: number;
  skills: number;
  instructions: number;
  extensions: number;
}

export interface LoadoutRow {
  id: string;
  name: string;
  scope: Scope;
  description?: string;
  status: LoadoutStatus;
  activation: ActivationMode | null;
  counts: LoadoutCounts;
  tools: string[];
  issue?: string;
  filePath?: string;
  slots: ArtifactSlot[];
}

export interface DashboardIssue {
  rowId: string;
  text: string;
}

export interface DashboardData {
  rows: LoadoutRow[];
  active: string[];
  tools: string[];
  issues: DashboardIssue[];
  warnings: string[];
}

type OwnerState = { active: Set<string>; configPath: string; projectRoot: string; scope: Scope };

const DRIFT_PRIORITY: Record<DriftResult["status"], number> = {
  ok: 0,
  modified: 1,
  unlinked: 2,
  misdirected: 3,
  missing: 4,
  broken: 5,
};

export async function loadDashboardData(cwd: string = process.cwd()): Promise<DashboardData> {
  const { entries, warnings } = await collectCatalogRoots(cwd);
  const ownerStates = ownerStateMap(entries);
  const seenByOwner = new Map<CatalogOwner, Set<string>>();
  const rows: LoadoutRow[] = [];
  const issues: DashboardIssue[] = [];

  for (const entry of entries) {
    const seen = seenByOwner.get(entry.owner) ?? new Set<string>();
    seenByOwner.set(entry.owner, seen);

    for (const name of listLoadouts(entry.root.path)) {
      if (seen.has(name)) continue;
      seen.add(name);

      const ownerState = ownerStates.get(entry.owner);
      const scope = ownerState?.scope ?? scopeFromRoot(entry.root);
      const id = `${scope}:${name}`;
      const filePath = loadoutDefinitionPath(entry.root.path, name);

      try {
        const definition = parseLoadoutDefinition(filePath);
        const chain = collectRootsWithSources(entry.root, false, entry.owner !== "bundled").roots;
        const rootConfig = parseRootConfig(entry.root.path);
        const resolved = resolveLoadout(name, chain, rootConfig);
        const slots = sortArtifacts(resolved.items.map((item) => ({
          kind: item.kind,
          name: getArtifactName(item.relativePath, item.kind),
          relativePath: item.relativePath,
          tools: item.tools,
        })));
        const tools = Array.from(new Set(slots.flatMap((slot) => slot.tools))).sort();
        const active = ownerState?.active.has(name) ?? false;
        const issue = active && ownerState
          ? await loadActiveIssue(ownerState, name, chain)
          : undefined;
        const status = issue ? "drift" : active ? "active" : "available";
        const row: LoadoutRow = {
          id,
          name,
          scope,
          description: definition.description,
          status,
          activation: active ? "filesystem" : null,
          counts: countSlots(slots),
          tools,
          issue,
          filePath,
          slots,
        };
        rows.push(row);
        if (issue) issues.push({ rowId: id, text: issue });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        rows.push({
          id,
          name,
          scope,
          status: "broken",
          activation: null,
          counts: { rules: 0, skills: 0, instructions: 0, extensions: 0 },
          tools: [],
          issue: text,
          filePath,
          slots: [],
        });
        issues.push({ rowId: id, text });
      }
    }
  }

  return {
    rows: sortRows(rows),
    active: rows.filter((row) => row.activation).map((row) => row.name),
    tools: Array.from(new Set(rows.flatMap((row) => row.tools))).sort(),
    issues,
    warnings,
  };
}

function ownerStateMap(entries: CatalogRootEntry[]): Map<CatalogOwner, OwnerState> {
  const map = new Map<CatalogOwner, OwnerState>();
  for (const owner of ["project", "global"] as const) {
    const primary = entries.find((entry) => entry.owner === owner && entry.root.level === owner);
    if (!primary) continue;
    map.set(owner, {
      active: new Set(loadState(primary.root.path)?.active ?? []),
      configPath: primary.root.path,
      projectRoot: owner === "project" ? path.dirname(primary.root.path) : os.homedir(),
      scope: owner,
    });
  }
  return map;
}

async function loadActiveIssue(
  state: OwnerState,
  name: string,
  roots: LoadoutRoot[]
): Promise<string | undefined> {
  const applied = loadState(state.configPath);
  if (!applied) return "active state missing";
  const loadout = resolveLoadout(name, roots, parseRootConfig(state.configPath));
  const plan = await planRender(loadout, state.projectRoot, state.scope, state.configPath);
  if (plan.errors.length > 0) return plan.errors[0];
  if (plan.shadowed.length > 0) return `${plan.shadowed.length} shadowed output(s)`;

  const targets = new Set(plan.outputs.map((output) => output.spec.targetPath));
  const sourcePaths = new Set(plan.outputs.map((output) => output.spec.sourcePath));
  const added = plan.outputs.some((output) => !applied.entries.some((entry) => entry.targetPath === output.spec.targetPath));
  const removed = applied.entries.some((entry) => !targets.has(entry.targetPath));
  if (added || removed) return "configuration drift";

  const worst = detectDrift(applied, state.projectRoot)
    .filter((result) => sourcePaths.has(result.entry.sourcePath))
    .sort((a, b) => DRIFT_PRIORITY[b.status] - DRIFT_PRIORITY[a.status])[0];
  return worst && worst.status !== "ok" ? `output ${worst.status}` : undefined;
}

function countSlots(slots: ArtifactSlot[]): LoadoutCounts {
  return {
    rules: slots.filter((slot) => slot.kind === "rule").length,
    skills: slots.filter((slot) => slot.kind === "skill").length,
    instructions: slots.filter((slot) => slot.kind === "instruction").length,
    extensions: slots.filter((slot) => slot.kind === "extension" || slot.kind === "extension-dir").length,
  };
}

function loadoutDefinitionPath(root: string, name: string): string {
  const yamlPath = path.join(root, "loadouts", `${name}.yaml`);
  return fileExists(yamlPath) ? yamlPath : path.join(root, "loadouts", `${name}.yml`);
}

function scopeFromRoot(root: LoadoutRoot): Scope {
  return root.level === "global" ? "global" : "project";
}

function sortRows(rows: LoadoutRow[]): LoadoutRow[] {
  const order: Record<LoadoutStatus, number> = { active: 0, drift: 1, available: 2, broken: 3 };
  return [...rows].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}
