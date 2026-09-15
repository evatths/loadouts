import { buildSections, firstCursor, type EquipLayer, type Model, type ScopeFilter, type Section } from "./model.js";
import type { Effect, Intent } from "./intent.js";
import type { LoadoutRow } from "./data.js";

export interface UpdateResult {
  model: Model;
  effect?: Effect;
}

const SECTIONS: Section[] = ["active", "available", "issues"];

export function update(model: Model, intent: Intent): UpdateResult {
  if (intent.t === "closeOverlay") return model.filtering ? cancelFilter(model) : { model: { ...model, overlay: null, diffLines: undefined } };
  if (intent.t === "filterStart") return withCursor({ ...model, filtering: true });
  if (intent.t === "filterInput") return withCursor({ ...model, filter: { ...model.filter, text: intent.text } });
  if (intent.t === "filterChar") return withCursor({ ...model, filter: { ...model.filter, text: model.filter.text + intent.char } });
  if (intent.t === "filterBackspace") return withCursor({ ...model, filter: { ...model.filter, text: model.filter.text.slice(0, -1) } });
  if (intent.t === "filterCommit") return { model: { ...model, filtering: false } };
  if (intent.t === "filterCancel") return cancelFilter(model);
  if (intent.t === "effectDone") return effectDone(model, intent);
  if (model.busy) return { model };
  if (model.filtering) return { model };
  if (intent.t === "openHelp") return { model: { ...model, overlay: "help" } };
  if (intent.t === "quit") return { model: { ...model, quitRequested: true } };
  if (intent.t === "cycleScope") return withCursor({ ...model, filter: { ...model.filter, scope: nextScope(model.filter.scope) } });
  if (intent.t === "cycleTool") return withCursor({ ...model, filter: { ...model.filter, tool: nextTool(model) } });
  if (intent.t === "cycleLayer") {
    const layer = model.layers[(model.layers.indexOf(model.layer) + 1) % model.layers.length];
    return { model: { ...model, layer, scope: layer === "session" ? model.scope : layer, undo: undefined } };
  }
  if (intent.t === "move") return { model: move(model, intent.delta) };
  if (intent.t === "section") return { model: moveSection(model, intent.dir) };
  if (intent.t === "enter") return { model: toggleDetail(model) };
  if (intent.t === "refresh") return { model: { ...model, busy: { label: "Refreshing" } }, effect: { t: "reload" } };
  if (intent.t === "edit") return edit(model);
  if (intent.t === "diffPreview") return plan(model);
  if (intent.t === "sync") return apply(model, activeNames(model, model.layer), "Syncing");
  if (intent.t === "clear") return clear(model);
  if (intent.t === "undo") return undo(model);
  if (intent.t === "activate" || intent.t === "deactivate" || intent.t === "toggle") return toggle(model, intent.t);
  return { model };
}

function cancelFilter(model: Model): UpdateResult {
  return withCursor({ ...model, filtering: false, filter: { ...model.filter, text: "" } });
}

function toggle(model: Model, action: "activate" | "deactivate" | "toggle"): UpdateResult {
  const row = cursorRow(model);
  if (!row || row.status === "broken") return { model };
  if (model.layer !== "session" && row.scope !== model.layer) {
    return { model: { ...model, lastResult: { text: `Select the ${row.scope} equip layer with m for this loadout.`, variant: "error" } } };
  }
  const active = row.equipped.includes(model.layer);
  const shouldActivate = action === "activate" || (action === "toggle" && !active);
  if ((shouldActivate && active) || (!shouldActivate && !active)) return { model };

  const nextRows: LoadoutRow[] = model.rows.map((candidate) => {
    let equipped = candidate.equipped;
    if (model.layer === "session" && candidate.scope !== row.scope) equipped = equipped.filter((layer) => layer !== "session");
    if (candidate.id === row.id) equipped = shouldActivate ? [...equipped, model.layer] : equipped.filter((layer) => layer !== model.layer);
    return { ...candidate, equipped, status: candidate.status === "broken" ? "broken" : equipped.length ? "active" : "available" };
  });
  const sections = buildSections(nextRows);
  const targetSet = activeNames({ ...model, rows: nextRows }, model.layer);
  return {
    model: {
      ...model,
      rows: nextRows,
      scope: row.scope,
      sections,
      cursor: cursorForId(sections, row.id),
      undo: snapshot(model),
      busy: { label: shouldActivate ? "Activating" : "Deactivating" },
      lastResult: undefined,
    },
    effect: { t: "apply", targetSet, layer: model.layer, scope: row.scope },
  };
}

function undo(model: Model): UpdateResult {
  if (!model.undo) return { model };
  return {
    model: { ...model, rows: model.undo.rows, sections: model.undo.sections, cursor: model.undo.cursor, scope: model.undo.scope, layer: model.undo.layer, undo: undefined, busy: { label: "Undoing" } },
    effect: { t: "apply", targetSet: model.undo.targetSet, layer: model.undo.layer, scope: model.undo.scope },
  };
}

function clear(model: Model): UpdateResult {
  const nextRows = model.rows.map((row) => {
    const equipped = row.equipped.filter((layer) => layer !== model.layer);
    return { ...row, equipped, status: row.status === "broken" ? "broken" as const : equipped.length ? "active" as const : "available" as const };
  });
  return {
    model: { ...model, rows: nextRows, sections: buildSections(nextRows), cursor: firstCursor(buildSections(nextRows)), undo: snapshot(model), busy: { label: "Clearing" } },
    effect: { t: "clear", layer: model.layer, scope: model.scope },
  };
}

function apply(model: Model, targetSet: string[], label: string): UpdateResult {
  return { model: { ...model, busy: { label }, undo: snapshot(model) }, effect: { t: "apply", targetSet, layer: model.layer, scope: model.scope } };
}

function plan(model: Model): UpdateResult {
  const targetSet = activeNames(model, model.layer);
  return { model: { ...model, busy: { label: "Planning diff" }, overlay: "diff" }, effect: { t: "plan", targetSet, layer: model.layer, scope: model.scope } };
}

function edit(model: Model): UpdateResult {
  const row = cursorRow(model);
  if (!row?.filePath) return { model };
  return { model, effect: { t: "editFile", path: row.filePath } };
}

function effectDone(model: Model, intent: Extract<Intent, { t: "effectDone" }>): UpdateResult {
  const rollback = !intent.ok && model.undo ? model.undo : undefined;
  return {
    model: {
      ...model,
      ...(rollback ? { rows: rollback.rows, sections: rollback.sections, cursor: rollback.cursor, scope: rollback.scope, layer: rollback.layer, undo: undefined } : {}),
      busy: null,
      diffLines: intent.effect === "plan" ? intent.data ?? [intent.message ?? "No changes"] : model.diffLines,
      lastResult: intent.message ? { text: intent.message, variant: intent.ok ? "success" : "error" } : model.lastResult,
    },
  };
}

function move(model: Model, delta: number): Model {
  const ids = visibleIds(model, model.cursor.section);
  if (ids.length === 0) return model;
  const index = clamp(model.cursor.index + delta, 0, ids.length - 1);
  return { ...model, cursor: { ...model.cursor, index } };
}

function moveSection(model: Model, dir: 1 | -1): Model {
  const current = SECTIONS.indexOf(model.cursor.section);
  for (let step = 1; step <= SECTIONS.length; step++) {
    const section = SECTIONS[(current + step * dir + SECTIONS.length) % SECTIONS.length];
    if (visibleIds(model, section).length > 0) return { ...model, cursor: { section, index: 0 } };
  }
  return model;
}

function toggleDetail(model: Model): Model {
  const row = cursorRow(model);
  if (!row) return model;
  return { ...model, detail: model.detail?.rowId === row.id ? undefined : { rowId: row.id } };
}

function withCursor(model: Model): UpdateResult {
  const ids = visibleIds(model, model.cursor.section);
  if (ids.length > 0) return { model: { ...model, cursor: { ...model.cursor, index: clamp(model.cursor.index, 0, ids.length - 1) } } };
  return { model: moveSection({ ...model, cursor: firstCursor(model.sections) }, 1) };
}

function cursorRow(model: Model): LoadoutRow | undefined {
  const id = visibleIds(model, model.cursor.section)[model.cursor.index];
  return model.rows.find((row) => row.id === id);
}

function visibleIds(model: Model, section: Section): string[] {
  return model.sections[section].filter((id) => {
    const row = model.rows.find((candidate) => candidate.id === id);
    if (!row) return false;
    if (model.filter.scope && row.scope !== model.filter.scope) return false;
    if (model.filter.tool && !row.tools.includes(model.filter.tool)) return false;
    const text = model.filter.text.trim().toLowerCase();
    return !text || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(text);
  });
}

function cursorForId(sections: Record<Section, string[]>, id: string): Model["cursor"] {
  for (const section of SECTIONS) {
    const index = sections[section].indexOf(id);
    if (index >= 0) return { section, index };
  }
  return firstCursor(sections);
}

function snapshot(model: Model) {
  return { rows: model.rows, sections: model.sections, cursor: model.cursor, targetSet: activeNames(model, model.layer), scope: model.scope, layer: model.layer };
}

function activeNames(model: Pick<Model, "rows">, layer: EquipLayer): string[] {
  return model.rows.filter((row) => row.equipped.includes(layer)).map((row) => row.name);
}

function nextScope(scope?: ScopeFilter): ScopeFilter | undefined {
  return scope === undefined ? "project" : scope === "project" ? "global" : undefined;
}

function nextTool(model: Model): string | undefined {
  const tools = Array.from(new Set(model.rows.flatMap((row) => row.tools))).sort();
  if (tools.length === 0) return undefined;
  const index = model.filter.tool ? tools.indexOf(model.filter.tool) : -1;
  return index < 0 ? tools[0] : index === tools.length - 1 ? undefined : tools[index + 1];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
