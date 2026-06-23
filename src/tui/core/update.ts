import { buildSections, firstCursor, type Model, type ScopeFilter, type Section } from "./model.js";
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
  if (model.filtering) return { model };
  if (intent.t === "openHelp") return { model: { ...model, overlay: "help" } };
  if (intent.t === "quit") return { model: { ...model, quitRequested: true } };
  if (intent.t === "cycleScope") return withCursor({ ...model, filter: { ...model.filter, scope: nextScope(model.filter.scope) } });
  if (intent.t === "cycleTool") return withCursor({ ...model, filter: { ...model.filter, tool: nextTool(model) } });
  if (intent.t === "cycleMode") return { model: { ...model, mode: model.mode === "filesystem" ? "runtime" : "filesystem" } };
  if (intent.t === "move") return { model: move(model, intent.delta) };
  if (intent.t === "section") return { model: moveSection(model, intent.dir) };
  if (intent.t === "enter") return { model: toggleDetail(model) };
  if (intent.t === "refresh") return { model: { ...model, busy: { label: "Refreshing" } }, effect: { t: "reload" } };
  if (intent.t === "edit") return edit(model);
  if (intent.t === "diffPreview") return plan(model);
  if (intent.t === "sync") return apply(model, activeNames(model, model.scope), "Syncing");
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
  const shouldActivate = action === "activate" || (action === "toggle" && !row.activation);
  if ((shouldActivate && row.activation) || (!shouldActivate && !row.activation)) return { model };

  const nextRows: LoadoutRow[] = model.rows.map((candidate) => candidate.id === row.id
    ? { ...candidate, status: shouldActivate ? "active" : "available", activation: shouldActivate ? model.mode : null, issue: undefined }
    : candidate);
  const sections = buildSections(nextRows);
  const targetSet = activeNames({ ...model, rows: nextRows }, row.scope);
  return {
    model: {
      ...model,
      rows: nextRows,
      sections,
      cursor: cursorForId(sections, row.id),
      undo: snapshot(model),
      busy: { label: shouldActivate ? "Activating" : "Deactivating" },
      lastResult: undefined,
    },
    effect: { t: "apply", targetSet, mode: model.mode, scope: row.scope },
  };
}

function undo(model: Model): UpdateResult {
  if (!model.undo) return { model };
  return {
    model: { ...model, rows: model.undo.rows, sections: model.undo.sections, cursor: model.undo.cursor, undo: undefined, busy: { label: "Undoing" } },
    effect: { t: "apply", targetSet: model.undo.targetSet, mode: model.mode, scope: model.undo.scope },
  };
}

function clear(model: Model): UpdateResult {
  const nextRows = model.rows.map((row) => row.activation && row.scope === model.scope ? { ...row, status: "available" as const, activation: null, issue: undefined } : row);
  return {
    model: { ...model, rows: nextRows, sections: buildSections(nextRows), cursor: firstCursor(buildSections(nextRows)), undo: snapshot(model), busy: { label: "Clearing" } },
    effect: { t: "clear", mode: model.mode, scope: model.scope },
  };
}

function apply(model: Model, targetSet: string[], label: string): UpdateResult {
  return { model: { ...model, busy: { label }, undo: snapshot(model) }, effect: { t: "apply", targetSet, mode: model.mode, scope: model.scope } };
}

function plan(model: Model): UpdateResult {
  const targetSet = activeNames(model, model.scope);
  return { model: { ...model, busy: { label: "Planning diff" }, overlay: "diff" }, effect: { t: "plan", targetSet, scope: model.scope } };
}

function edit(model: Model): UpdateResult {
  const row = cursorRow(model);
  if (!row?.filePath) return { model };
  return { model, effect: { t: "editFile", path: row.filePath } };
}

function effectDone(model: Model, intent: Extract<Intent, { t: "effectDone" }>): UpdateResult {
  return {
    model: {
      ...model,
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
  return { rows: model.rows, sections: model.sections, cursor: model.cursor, targetSet: activeNames(model, model.scope), scope: model.scope };
}

function activeNames(model: Pick<Model, "rows">, scope?: ScopeFilter): string[] {
  return model.rows.filter((row) => row.activation && (!scope || row.scope === scope)).map((row) => row.name);
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
