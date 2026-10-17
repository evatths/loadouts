import type { DashboardData, LoadoutRow } from "./data.js";

export type Section = "active" | "available" | "issues";
export type EquipLayer = "global" | "project" | "session";
export type EquipMode = "filesystem" | "session";
export type ScopeFilter = "global" | "project";
export type BulkAction = "sync" | "clear" | "diffPreview";

export interface DetailModel {
  rowId: string;
  scroll?: number;
}

export interface UndoSnapshot {
  rows: LoadoutRow[];
  sections: Record<Section, string[]>;
  cursor: { section: Section; index: number };
  targetSet: string[];
  scope: ScopeFilter;
  layer: EquipLayer;
}

export interface Model {
  rows: LoadoutRow[];
  sections: Record<Section, string[]>;
  cursor: { section: Section; index: number };
  filter: { text: string; scope?: ScopeFilter; tool?: string };
  filtering: boolean;
  mode: EquipMode;
  sessionAvailable: boolean;
  sessionScope: ScopeFilter;
  undo?: UndoSnapshot;
  rollback?: UndoSnapshot;
  detail?: DetailModel;
  overlay?: "help" | "diff" | "confirm" | null;
  overlayScroll: number;
  confirm?: { action: BulkAction; scope: ScopeFilter };
  pendingTop?: boolean;
  busy?: { label: string } | null;
  lastResult?: { text: string; variant: "info" | "success" | "error" };
  diffLines?: string[];
  quitRequested?: boolean;
}

export function createInitialModel(
  data: DashboardData,
  options: { mode?: EquipMode; sessionAvailable?: boolean; sessionScope?: ScopeFilter } = {}
): Model {
  const sections = buildSections(data.rows);
  return {
    rows: data.rows,
    sections,
    cursor: firstCursor(sections),
    filter: { text: "" },
    filtering: false,
    mode: options.sessionAvailable ? options.mode ?? "filesystem" : "filesystem",
    sessionAvailable: options.sessionAvailable ?? false,
    sessionScope: options.sessionScope ?? "project",
    overlay: null,
    overlayScroll: 0,
    busy: null,
    lastResult: data.issues.length
      ? { text: `${data.issues.length} issue(s) detected`, variant: "error" }
      : undefined,
  };
}

export function buildSections(rows: LoadoutRow[]): Record<Section, string[]> {
  return {
    active: rows.filter((r) => r.status === "active" || r.status === "drift").map((r) => r.id),
    available: rows.filter((r) => r.status === "available").map((r) => r.id),
    issues: rows.filter((r) => r.status === "broken").map((r) => r.id),
  };
}

export function firstCursor(sections: Record<Section, string[]>): Model["cursor"] {
  for (const section of ["active", "available", "issues"] as const) {
    if (sections[section].length > 0) return { section, index: 0 };
  }
  return { section: "active", index: 0 };
}
