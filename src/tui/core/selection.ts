import type { LoadoutRow } from "./data.js";
import { firstCursor, type EquipLayer, type Model, type Section } from "./model.js";

export const SECTIONS: Section[] = ["active", "available", "issues"];
export const SCOPES = [undefined, "global", "project"] as const;

export function visibleRows(model: Model, section: Section): LoadoutRow[] {
  const text = model.filter.text.trim().toLowerCase();
  const byId = new Map(model.rows.map((row) => [row.id, row]));
  return model.sections[section]
    .map((id) => byId.get(id))
    .filter((row): row is LoadoutRow => Boolean(row))
    .filter((row) => (!model.filter.scope || row.scope === model.filter.scope)
      && (!model.filter.tool || row.tools.includes(model.filter.tool))
      && (!text || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(text)));
}

export function cursorRow(model: Model): LoadoutRow | undefined {
  return visibleRows(model, model.cursor.section)[model.cursor.index];
}

/** Preserve identity across filtering, section changes, and persisted-state reloads. */
export function normalizeCursor(model: Model, rowId?: string): Model {
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, visibleRows(model, section).map((row) => row.id)])) as Model["sections"];
  if (rowId) {
    for (const section of SECTIONS) {
      const index = sections[section].indexOf(rowId);
      if (index >= 0) return { ...model, cursor: { section, index } };
    }
  }
  const ids = sections[model.cursor.section];
  const cursor = ids.length
    ? { ...model.cursor, index: Math.max(0, Math.min(model.cursor.index, ids.length - 1)) }
    : firstCursor(sections);
  return { ...model, cursor };
}

export function rowLayer(model: Model, row: LoadoutRow): EquipLayer {
  return model.mode === "session" ? "session" : row.scope;
}

export function activeNames(model: Pick<Model, "rows">, layer: EquipLayer): string[] {
  return model.rows.filter((row) => row.equipped.includes(layer)).map((row) => row.name);
}

export function sessionScope(model: Model) {
  return model.rows.find((row) => row.equipped.includes("session"))?.scope ?? model.sessionScope;
}
