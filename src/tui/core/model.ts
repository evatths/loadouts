import type { DashboardData, LoadoutRow } from "./data.js";

export type Section = "active" | "available" | "issues";
export type ActivationMode = "filesystem" | "runtime";
export type ScopeFilter = "global" | "project";

export interface DetailModel {
  rowId: string;
}

export interface UndoSnapshot {
  rows: LoadoutRow[];
  sections: Record<Section, string[]>;
  cursor: { section: Section; index: number };
  targetSet: string[];
  scope: ScopeFilter;
}

export interface Model {
  rows: LoadoutRow[];
  sections: Record<Section, string[]>;
  cursor: { section: Section; index: number };
  filter: { text: string; scope?: ScopeFilter; tool?: string };
  filtering: boolean;
  mode: ActivationMode;
  scope: ScopeFilter;
  staged?: Set<string>;
  undo?: UndoSnapshot;
  detail?: DetailModel;
  overlay?: "help" | "diff" | "confirm" | null;
  busy?: { label: string } | null;
  lastResult?: { text: string; variant: "info" | "success" | "error" };
  diffLines?: string[];
  quitRequested?: boolean;
}

export function createInitialModel(
  data: DashboardData,
  options: { mode?: ActivationMode; scope?: ScopeFilter } = {}
): Model {
  const sections = buildSections(data.rows);
  return {
    rows: data.rows,
    sections,
    cursor: firstCursor(sections),
    filter: { text: "" },
    filtering: false,
    mode: options.mode ?? "filesystem",
    scope: options.scope ?? "project",
    staged: new Set(),
    overlay: null,
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
