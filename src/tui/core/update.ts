import { buildSections, type BulkAction, type EquipLayer, type Model, type ScopeFilter, type UndoSnapshot } from "./model.js";
import type { Effect, Intent } from "./intent.js";
import type { LoadoutRow } from "./data.js";
import { activeNames, cursorRow, normalizeCursor, rowLayer, SCOPES, SECTIONS, sessionScope, visibleRows } from "./selection.js";
import { keymap } from "./keymap.js";

export interface UpdateResult {
  model: Model;
  effect?: Effect;
}

export function update(model: Model, intent: Intent): UpdateResult {
  if (intent.t === "effectDone") return effectDone(model, intent);
  if (model.busy) {
    if (intent.t === "closeOverlay" && model.overlay) return { model: closeOverlay(model) };
    return { model };
  }
  if (intent.t !== "topPrefix" && model.pendingTop) model = { ...model, pendingTop: false };
  if (model.overlay) return updateOverlay(model, intent);
  if (intent.t === "closeOverlay") return escape(model);
  if (intent.t === "filterStart") return { model: { ...model, filtering: true } };
  if (intent.t === "filterInput") return refilter(model, { ...model.filter, text: intent.text });
  if (intent.t === "filterChar") return refilter(model, { ...model.filter, text: model.filter.text + intent.char });
  if (intent.t === "filterBackspace") return refilter(model, { ...model.filter, text: model.filter.text.slice(0, -1) });
  if (intent.t === "filterCommit") return { model: { ...model, filtering: false } };
  if (intent.t === "filterCancel") return refilter({ ...model, filtering: false }, { ...model.filter, text: "" });
  if (model.filtering) return { model };
  if (intent.t === "openHelp") return { model: { ...model, overlay: "help", overlayScroll: 0 } };
  if (intent.t === "quit") return { model: { ...model, quitRequested: true } };
  if (intent.t === "cycleScope") {
    const index = SCOPES.indexOf(model.filter.scope);
    return refilter(model, { ...model.filter, scope: SCOPES[(index + intent.dir + SCOPES.length) % SCOPES.length] });
  }
  if (intent.t === "cycleTool") return refilter(model, { ...model.filter, tool: nextTool(model) });
  if (intent.t === "cycleMode") return { model: model.sessionAvailable ? { ...model, mode: model.mode === "session" ? "filesystem" : "session" } : model };
  if (intent.t === "topPrefix") return model.pendingTop ? { model: move({ ...model, pendingTop: false }, -Infinity) } : { model: { ...model, pendingTop: true } };
  if (intent.t === "edge") return { model: move(model, intent.edge === "first" ? -Infinity : Infinity) };
  if (intent.t === "move") return { model: move(model, intent.delta) };
  if (intent.t === "section") return { model: moveSection(model, intent.dir) };
  if (intent.t === "selectSection") return { model: { ...model, cursor: { section: intent.section, index: 0 } } };
  if (intent.t === "detailScroll") {
    const row = cursorRow(model);
    if (!row) return { model };
    const scroll = model.detail?.rowId === row.id ? model.detail.scroll ?? 0 : 0;
    return { model: { ...model, detail: { rowId: row.id, scroll: Math.max(0, Math.min(row.slots.length + 4, scroll + intent.delta)) } } };
  }
  if (intent.t === "enter") {
    const row = cursorRow(model);
    return { model: row ? { ...model, detail: model.detail?.rowId === row.id ? undefined : { rowId: row.id } } : model };
  }
  if (intent.t === "refresh") return { model: { ...model, busy: { label: "Refreshing" } }, effect: { t: "reload" } };
  if (intent.t === "edit") {
    const row = cursorRow(model);
    return { model, effect: row?.filePath ? { t: "editFile", path: row.filePath } : undefined };
  }
  if (intent.t === "diffPreview" || intent.t === "sync" || intent.t === "clear") return bulk(model, intent.t);
  if (intent.t === "undo") return undo(model);
  if (intent.t === "activate" || intent.t === "deactivate" || intent.t === "toggle") return toggle(model, intent.t);
  return { model };
}

function closeOverlay(model: Model): Model {
  return { ...model, overlay: null, confirm: undefined, diffLines: undefined, overlayScroll: 0, pendingTop: false };
}

function escape(model: Model): UpdateResult {
  if (model.filtering || model.filter.text || model.filter.tool) return refilter({ ...model, filtering: false }, { scope: model.filter.scope, text: "" });
  if (model.detail) return { model: { ...model, detail: undefined } };
  if (model.filter.scope) return refilter(model, { ...model.filter, scope: undefined });
  return { model: { ...model, quitRequested: true } };
}

function updateOverlay(model: Model, intent: Intent): UpdateResult {
  if (intent.t === "closeOverlay" || intent.t === "quit") return { model: closeOverlay(model) };
  if (model.confirm) {
    if (intent.t === "enter") return bulk(closeOverlay(model), model.confirm.action, model.confirm.scope);
    if (["move", "section", "cycleScope"].includes(intent.t)) return { model: { ...model, confirm: { ...model.confirm, scope: model.confirm.scope === "global" ? "project" : "global" } } };
    return { model };
  }
  if (intent.t === "openHelp") return { model: { ...model, overlay: "help", overlayScroll: 0 } };
  const last = Math.max(0, (model.overlay === "help" ? keymap.length : model.diffLines?.length ?? 1) - 1);
  if (intent.t === "move" || intent.t === "detailScroll") return { model: { ...model, overlayScroll: Math.max(0, Math.min(last, model.overlayScroll + intent.delta)) } };
  if (intent.t === "edge") return { model: { ...model, overlayScroll: intent.edge === "first" ? 0 : last } };
  return { model };
}

function refilter(model: Model, filter: Model["filter"]): UpdateResult {
  const next = normalizeCursor({ ...model, filter }, cursorRow(model)?.id);
  return { model: { ...next, detail: cursorRow(next)?.id === model.detail?.rowId ? model.detail : undefined } };
}

function toggle(model: Model, action: "activate" | "deactivate" | "toggle"): UpdateResult {
  const row = cursorRow(model);
  if (!row || row.status === "broken") return { model };
  const layer = rowLayer(model, row);
  const active = row.equipped.includes(layer);
  const shouldActivate = action === "activate" || (action === "toggle" && !active);
  if ((shouldActivate && active) || (!shouldActivate && !active)) return { model };

  const rows = model.rows.map((candidate) => {
    let equipped = candidate.equipped;
    if (layer === "session" && candidate.scope !== row.scope) equipped = equipped.filter((item) => item !== "session");
    if (candidate.id === row.id) equipped = shouldActivate ? [...equipped, layer] : equipped.filter((item) => item !== layer);
    return withEquipment(candidate, equipped);
  });
  const next = normalizeCursor({ ...model, rows, sections: buildSections(rows), sessionScope: layer === "session" ? row.scope : model.sessionScope }, row.id);
  return mutation(model, next, { t: "apply", targetSet: activeNames(next, layer), layer, scope: row.scope }, shouldActivate ? "Activating" : "Deactivating");
}

function bulk(model: Model, action: BulkAction, chosenScope?: ScopeFilter): UpdateResult {
  const scope = model.mode === "session" ? sessionScope(model) : chosenScope ?? model.filter.scope;
  if (!scope) return { model: { ...model, overlay: "confirm", overlayScroll: 0, confirm: { action, scope: cursorRow(model)?.scope ?? "project" } } };
  if (model.mode === "session" && model.filter.scope && model.filter.scope !== scope) {
    return { model: { ...model, lastResult: { text: `No session loadouts from ${model.filter.scope}.`, variant: "info" } } };
  }
  const layer = model.mode === "session" ? "session" : scope;
  const targetSet = activeNames(model, layer);
  if (action === "diffPreview") return { model: { ...model, busy: { label: "Planning diff" }, overlay: "diff", overlayScroll: 0, diffLines: undefined }, effect: { t: "plan", targetSet, layer, scope } };
  if (action === "sync") return mutation(model, model, { t: "apply", targetSet, layer, scope }, "Syncing");
  const rows = model.rows.map((row) => withEquipment(row, row.equipped.filter((item) => item !== layer)));
  const next = normalizeCursor({ ...model, rows, sections: buildSections(rows) }, cursorRow(model)?.id);
  return mutation(model, next, { t: "clear", layer, scope }, "Clearing");
}

function mutation(before: Model, next: Model, effect: Extract<Effect, { t: "apply" | "clear" }>, label: string): UpdateResult {
  const saved = snapshot(before, effect.layer, effect.scope);
  return { model: { ...next, undo: saved, rollback: saved, busy: { label }, lastResult: undefined }, effect };
}

function undo(model: Model): UpdateResult {
  const saved = model.undo;
  if (!saved) return { model };
  return {
    model: { ...restore(model, saved), undo: undefined, rollback: snapshot(model, saved.layer, saved.scope), busy: { label: "Undoing" } },
    effect: { t: "apply", targetSet: saved.targetSet, layer: saved.layer, scope: saved.scope },
  };
}

function effectDone(model: Model, intent: Extract<Intent, { t: "effectDone" }>): UpdateResult {
  const rollback = !intent.ok && model.rollback;
  return {
    model: {
      ...(rollback ? { ...restore(model, rollback), undo: undefined } : model),
      rollback: undefined,
      busy: null,
      diffLines: intent.effect === "plan" ? intent.data ?? [intent.message ?? "No changes"] : model.diffLines,
      lastResult: intent.message ? { text: intent.message, variant: intent.ok ? "success" : "error" } : model.lastResult,
    },
  };
}

function withEquipment(row: LoadoutRow, equipped: EquipLayer[]): LoadoutRow {
  if (equipped.length === row.equipped.length && equipped.every((layer, i) => layer === row.equipped[i])) return row;
  return { ...row, equipped, status: row.status === "broken" || (row.status === "drift" && equipped.includes(row.scope)) ? row.status : equipped.length ? "active" : "available" };
}

function move(model: Model, delta: number): Model {
  const rows = visibleRows(model, model.cursor.section);
  return { ...model, cursor: { ...model.cursor, index: Math.max(0, Math.min(model.cursor.index + delta, rows.length - 1)) } };
}

function moveSection(model: Model, dir: 1 | -1): Model {
  const current = SECTIONS.indexOf(model.cursor.section);
  for (let step = 1; step <= SECTIONS.length; step++) {
    const section = SECTIONS[(current + step * dir + SECTIONS.length) % SECTIONS.length];
    if (visibleRows(model, section).length > 0) return { ...model, cursor: { section, index: 0 } };
  }
  return model;
}

function snapshot(model: Model, layer: EquipLayer, scope: ScopeFilter): UndoSnapshot {
  return { rows: model.rows, sections: model.sections, cursor: model.cursor, targetSet: activeNames(model, layer), scope: layer === "session" ? sessionScope(model) : scope, layer };
}

function restore(model: Model, saved: UndoSnapshot): Model {
  const rowId = cursorRow({ ...model, rows: saved.rows, sections: saved.sections, cursor: saved.cursor })?.id;
  return normalizeCursor({ ...model, rows: saved.rows, sections: saved.sections, cursor: saved.cursor, mode: saved.layer === "session" ? "session" : "filesystem", sessionScope: saved.layer === "session" ? saved.scope : model.sessionScope }, rowId);
}

function nextTool(model: Model): string | undefined {
  const tools = Array.from(new Set(model.rows.flatMap((row) => row.tools))).sort();
  const index = model.filter.tool ? tools.indexOf(model.filter.tool) : -1;
  return tools[index + 1];
}
