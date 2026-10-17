import { describe, expect, it } from "vitest";
import { createInitialModel, type EquipLayer, type Model } from "./model.js";
import { update } from "./update.js";
import type { DashboardData } from "./data.js";

function model(): Model {
  return createInitialModel(data());
}

function data(): DashboardData {
  return {
    active: ["base", "data"],
    tools: ["claude-code", "opencode"],
    warnings: [],
    issues: [{ rowId: "project:data", text: "configuration drift" }],
    rows: [
      row("project:base", "base", "project", "active", ["project"]),
      row("project:data", "data", "project", "drift", ["project"], "configuration drift"),
      row("global:meta", "meta", "global", "available", []),
      row("project:bad", "bad", "project", "broken", [], "missing include"),
    ],
  };
}

function row(id: string, name: string, scope: "project" | "global", status: "active" | "available" | "drift" | "broken", equipped: EquipLayer[], issue?: string) {
  return {
    id,
    name,
    scope,
    description: `${name} description`,
    status,
    equipped,
    counts: { rules: 1, skills: name === "base" ? 1 : 0, instructions: 0, extensions: 0 },
    tools: ["claude-code", "opencode"],
    issue,
    filePath: `/loadouts/${name}.yaml`,
    slots: [
      { kind: "rule", name: `${name}-rule`, relativePath: `rules/${name}.md`, tools: ["claude-code"] },
      ...(name === "base" ? [{ kind: "skill", name: "debug", relativePath: "skills/debug", tools: ["opencode"] }] : []),
    ],
  };
}

describe("update", () => {
  it("moves, filters, cycles filters, and toggles detail", () => {
    let result = update(model(), { t: "move", delta: 1 });
    expect(result.model.cursor).toEqual({ section: "active", index: 1 });

    result = update(result.model, { t: "filterInput", text: "base" });
    expect(result.model.cursor).toEqual({ section: "active", index: 0 });

    result = update(result.model, { t: "cycleScope", dir: -1 });
    expect(result.model.filter.scope).toBe("project");

    result = update(result.model, { t: "cycleTool" });
    expect(result.model.filter.tool).toBe("claude-code");

    result = update(result.model, { t: "enter" });
    expect(result.model.detail).toEqual({ rowId: "project:base" });
  });

  it("switches filesystem/session only when a session is available", () => {
    expect(update(model(), { t: "cycleMode" }).model.mode).toBe("filesystem");
    const withSession = createInitialModel(data(), { sessionAvailable: true });
    let cycled = update(withSession, { t: "cycleMode" });
    expect(cycled.model.mode).toBe("session");
    cycled = update(cycled.model, { t: "cycleMode" });
    expect(cycled.model.mode).toBe("filesystem");
  });

  it("supports live filter entry, commit, cancel, and ignores normal bindings while filtering", () => {
    let result = update(model(), { t: "filterStart" });
    expect(result.model.filtering).toBe(true);
    expect(result.model.filter.text).toBe("");

    result = update(result.model, { t: "filterChar", char: "m" });
    result = update(result.model, { t: "filterChar", char: "e" });
    expect(result.model.filter.text).toBe("me");
    expect(result.model.cursor).toEqual({ section: "available", index: 0 });

    result = update(result.model, { t: "move", delta: 1 });
    expect(result.model.cursor).toEqual({ section: "available", index: 0 });

    result = update(result.model, { t: "quit" });
    expect(result.model.quitRequested).toBeUndefined();

    result = update(result.model, { t: "filterBackspace" });
    expect(result.model.filter.text).toBe("m");

    result = update(result.model, { t: "filterCommit" });
    expect(result.model.filtering).toBe(false);
    expect(result.model.filter.text).toBe("m");

    result = update(result.model, { t: "filterStart" });
    expect(result.model.filter.text).toBe("m");
    result = update(result.model, { t: "filterChar", char: "b" });
    result = update(result.model, { t: "filterCancel" });
    expect(result.model.filtering).toBe(false);
    expect(result.model.filter.text).toBe("");
  });

  it("treats closeOverlay as filter cancel while filter entry is active", () => {
    let result = update(model(), { t: "filterStart" });
    result = update(result.model, { t: "filterChar", char: "b" });
    result = update(result.model, { t: "closeOverlay" });

    expect(result.model.filtering).toBe(false);
    expect(result.model.filter.text).toBe("");
    expect(result.model.overlay).toBeNull();
  });

  it("infers the filesystem target from the row", () => {
    let result = update(model(), { t: "section", dir: 1 });
    expect(result.model.cursor).toEqual({ section: "available", index: 0 });

    result = update(result.model, { t: "toggle" });
    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "global", scope: "global" });
  });

  it("toggles immediately and can undo the previous layer state", () => {
    let result = update(model(), { t: "section", dir: 1 });
    result = update(result.model, { t: "toggle" });

    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "global", scope: "global" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual(["global"]);
    expect(result.model.undo?.targetSet).toEqual([]);
    expect(result.model.busy).toEqual({ label: "Activating" });

    result = update(result.model, { t: "effectDone", effect: "apply", ok: true, message: "Equipped meta" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual(["global"]);

    result = update(result.model, { t: "undo" });
    expect(result.effect).toEqual({ t: "apply", targetSet: [], layer: "global", scope: "global" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual([]);
    expect(result.model.busy).toEqual({ label: "Undoing" });
  });

  it("blocks mutating intents while an effect is in flight", () => {
    let result = update(model(), { t: "section", dir: 1 });
    result = update(result.model, { t: "toggle" });
    const busy = result.model;
    expect(busy.busy).toEqual({ label: "Activating" });

    const blocked = update(busy, { t: "toggle" });
    expect(blocked.model).toBe(busy);
    expect(blocked.effect).toBeUndefined();

    const blockedUndo = update(busy, { t: "undo" });
    expect(blockedUndo.model).toBe(busy);
    expect(blockedUndo.effect).toBeUndefined();

    const done = update(busy, { t: "effectDone", effect: "apply", ok: true, message: "Equipped meta" });
    expect(done.model.busy).toBeNull();
    expect(done.model.lastResult).toEqual({ text: "Equipped meta", variant: "success" });
  });

  it("rolls the optimistic row back when the effect fails", () => {
    let result = update(model(), { t: "section", dir: 1 });
    result = update(result.model, { t: "toggle" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual(["global"]);

    const failed = update(result.model, { t: "effectDone", effect: "apply", ok: false, message: "apply failed" });
    expect(failed.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual([]);
    expect(failed.model.busy).toBeNull();
    expect(failed.model.undo).toBeUndefined();
    expect(failed.model.lastResult).toEqual({ text: "apply failed", variant: "error" });
  });

  it("keeps the global equip when unequipping a globally and session-equipped row", () => {
    const sessionData: DashboardData = {
      ...data(),
      rows: data().rows.map((row) =>
        row.id === "global:meta" ? { ...row, equipped: ["global", "session"] as EquipLayer[], status: "active" as const } : row
      ),
    };
    const base = createInitialModel(sessionData, { sessionAvailable: true });
    let result = update(base, { t: "move", delta: 2 });
    expect(result.model.cursor).toEqual({ section: "active", index: 2 });

    result = update(result.model, { t: "cycleMode" });
    expect(result.model.mode).toBe("session");

    result = update(result.model, { t: "toggle" });
    expect(result.effect).toEqual({ t: "apply", targetSet: [], layer: "session", scope: "global" });
    const unequipped = result.model.rows.find((row) => row.id === "global:meta");
    expect(unequipped?.equipped).toEqual(["global"]);
    expect(unequipped?.status).toBe("active");
    expect(result.model.busy).toEqual({ label: "Deactivating" });

    result = update(result.model, { t: "effectDone", effect: "apply", ok: true, message: "Unequipped meta" });
    result = update(result.model, { t: "undo" });
    const restored = result.model.rows.find((row) => row.id === "global:meta");
    expect(restored?.equipped).toEqual(["global", "session"]);
    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "session", scope: "global" });
  });

  it("returns effects for async intents and records results", () => {
    const scoped = update(model(), { t: "cycleScope", dir: -1 }).model;
    let result = update(scoped, { t: "diffPreview" });
    expect(result.effect).toEqual({ t: "plan", targetSet: ["base", "data"], layer: "project", scope: "project" });
    expect(result.model.overlay).toBe("diff");

    result = update(result.model, { t: "effectDone", effect: "plan", ok: true, message: "Diff ready", data: ["+ rule x"] });
    expect(result.model.busy).toBeNull();
    expect(result.model.diffLines).toEqual(["+ rule x"]);

    result = update(result.model, { t: "openHelp" });
    expect(result.model.overlay).toBe("help");
    result = update(result.model, { t: "closeOverlay" });
    expect(result.model.overlay).toBeNull();
  });

  it("cycles All/Global/Project in both directions and keeps filtering independent of mode", () => {
    let next = model();
    expect(next.filter.scope).toBeUndefined();
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    expect(next.filter.scope).toBe("global");
    expect(next.cursor).toEqual({ section: "available", index: 0 });
    expect(next.mode).toBe("filesystem");
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    expect(next.filter.scope).toBe("project");
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    expect(next.filter.scope).toBeUndefined();
    expect(update(next, { t: "cycleScope", dir: -1 }).model.filter.scope).toBe("project");
  });

  it("uses the tab for bulk effects and asks for a scope in All", () => {
    for (const action of ["sync", "clear", "diffPreview"] as const) {
      const prompt = update(model(), { t: action });
      expect(prompt.effect).toBeUndefined();
      expect(prompt.model.confirm).toEqual({ action, scope: "project" });
      const chosen = update(prompt.model, { t: "section", dir: 1 }).model;
      expect(chosen.confirm?.scope).toBe("global");
      const confirmed = update(chosen, { t: "enter" });
      expect(confirmed.effect).toMatchObject({ layer: "global", scope: "global" });
      expect(confirmed.model.filter.scope).toBeUndefined();
      expect(update(prompt.model, { t: "closeOverlay" }).model.confirm).toBeUndefined();
      expect(update(prompt.model, { t: "activate" }).effect).toBeUndefined();
    }
    const project = update(model(), { t: "cycleScope", dir: -1 }).model;
    expect(update(project, { t: "sync" }).effect).toEqual({ t: "apply", targetSet: ["base", "data"], layer: "project", scope: "project" });
    expect(update(project, { t: "clear" }).effect).toEqual({ t: "clear", layer: "project", scope: "project" });
  });

  it("keeps duplicate names scope-isolated and undo targets the inferred scope after tab changes", () => {
    const both = data();
    both.rows.push(row("global:base", "base", "global", "available", []));
    let next = createInitialModel(both);
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    next = update(next, { t: "move", delta: 1 }).model;
    const equipped = update(next, { t: "toggle" });
    expect(equipped.effect).toEqual({ t: "apply", targetSet: ["base"], layer: "global", scope: "global" });
    expect(equipped.model.cursor).toEqual({ section: "active", index: 0 });
    next = update(equipped.model, { t: "effectDone", effect: "apply", ok: true }).model;
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    const undone = update(next, { t: "undo" });
    expect(undone.effect).toEqual({ t: "apply", targetSet: [], layer: "global", scope: "global" });
    expect(undone.model.rows.find((row) => row.id === "project:base")?.equipped).toEqual(["project"]);
  });

  it("restores the previous source scope after switching a session's equipment", () => {
    const sessionData = data();
    sessionData.rows[0].equipped.push("session");
    let next = createInitialModel(sessionData, { mode: "session", sessionAvailable: true });
    next = update(next, { t: "section", dir: 1 }).model;
    const equipped = update(next, { t: "activate" });
    expect(equipped.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "session", scope: "global" });
    expect(equipped.model.rows[0].equipped).toEqual(["project"]);
    next = update(equipped.model, { t: "effectDone", effect: "apply", ok: true }).model;
    expect(update(next, { t: "undo" }).effect).toEqual({ t: "apply", targetSet: ["base"], layer: "session", scope: "project" });
    next = update(next, { t: "cycleScope", dir: -1 }).model;
    expect(update(next, { t: "clear" }).effect).toBeUndefined();
    expect(update(next, { t: "sync" }).effect).toBeUndefined();
  });

  it("unwinds overlays, filters, expanded detail, and scope before quitting", () => {
    let next = update(model(), { t: "cycleScope", dir: -1 }).model;
    next = update(next, { t: "enter" }).model;
    next = { ...next, filter: { ...next.filter, text: "base" } };
    next = update(next, { t: "openHelp" }).model;
    expect(update(next, { t: "toggle" }).effect).toBeUndefined();
    next = update(next, { t: "closeOverlay" }).model;
    expect(next.overlay).toBeNull();
    next = update(next, { t: "closeOverlay" }).model;
    expect(next.filter.text).toBe("");
    expect(next.quitRequested).toBeUndefined();
    next = update(next, { t: "closeOverlay" }).model;
    expect(next.detail).toBeUndefined();
    expect(next.filter.scope).toBe("project");
    next = update(next, { t: "closeOverlay" }).model;
    expect(next.filter.scope).toBeUndefined();
    expect(next.quitRequested).toBeUndefined();
    next = update(next, { t: "closeOverlay" }).model;
    expect(next.quitRequested).toBe(true);
    const detail = update(model(), { t: "enter" }).model;
    expect(update(detail, { t: "closeOverlay" }).model.detail).toBeUndefined();
  });

  it("jumps to sections and list edges, and interrupts gg with another action", () => {
    let next = update(model(), { t: "edge", edge: "last" }).model;
    expect(next.cursor.index).toBe(1);
    next = update(next, { t: "topPrefix" }).model;
    expect(next.cursor.index).toBe(1);
    next = update(next, { t: "topPrefix" }).model;
    expect(next.cursor.index).toBe(0);
    next = update(next, { t: "topPrefix" }).model;
    next = update(next, { t: "move", delta: 1 }).model;
    next = update(next, { t: "topPrefix" }).model;
    expect(next.cursor.index).toBe(1);
    next = update(next, { t: "selectSection", section: "issues" }).model;
    expect(next.cursor).toEqual({ section: "issues", index: 0 });
    expect(update(next, { t: "toggle" }).effect).toBeUndefined();
  });

  it("does not roll back the last successful mutation when a subsequent diff fails", () => {
    let next = update(model(), { t: "toggle" }).model;
    next = update(next, { t: "effectDone", effect: "apply", ok: true }).model;
    next = update(next, { t: "cycleScope", dir: -1 }).model;
    next = update(next, { t: "diffPreview" }).model;
    next = update(next, { t: "effectDone", effect: "plan", ok: false, message: "diff failed" }).model;
    expect(next.rows[0].equipped).toEqual([]);
    expect(next.undo).toBeDefined();
  });
});
