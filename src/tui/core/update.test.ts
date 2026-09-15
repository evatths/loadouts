import { describe, expect, it } from "vitest";
import { createInitialModel, type EquipLayer, type Model } from "./model.js";
import { update } from "./update.js";
import type { DashboardData } from "./data.js";

function model(): Model {
  return createInitialModel(data(), { scope: "project" });
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

    result = update(result.model, { t: "cycleScope" });
    expect(result.model.filter.scope).toBe("project");

    result = update(result.model, { t: "cycleTool" });
    expect(result.model.filter.tool).toBe("claude-code");

    result = update(result.model, { t: "enter" });
    expect(result.model.detail).toEqual({ rowId: "project:base" });
  });

  it("cycles equip layers with m, including session when configured", () => {
    let result = update(model(), { t: "cycleLayer" });
    expect(result.model.layer).toBe("global");
    result = update(result.model, { t: "cycleLayer" });
    expect(result.model.layer).toBe("project");

    const withSession = createInitialModel(data(), { layers: ["global", "project", "session"] });
    let cycled = update(withSession, { t: "cycleLayer" });
    expect(cycled.model.layer).toBe("session");
    cycled = update(cycled.model, { t: "cycleLayer" });
    expect(cycled.model.layer).toBe("global");
    cycled = update(cycled.model, { t: "cycleLayer" });
    expect(cycled.model.layer).toBe("project");
    cycled = update(cycled.model, { t: "cycleLayer" });
    expect(cycled.model.layer).toBe("session");
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

  it("toggles only when the row scope matches the selected layer", () => {
    let result = update(model(), { t: "section", dir: 1 });
    expect(result.model.cursor).toEqual({ section: "available", index: 0 });

    const rejected = update(result.model, { t: "toggle" });
    expect(rejected.effect).toBeUndefined();
    expect(rejected.model.rows.find((row) => row.id === "global:meta")?.equipped).toEqual([]);
    expect(rejected.model.lastResult?.variant).toBe("error");

    result = update(result.model, { t: "cycleLayer" });
    result = update(result.model, { t: "toggle" });
    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "global", scope: "global" });
  });

  it("toggles immediately and can undo the previous layer state", () => {
    let result = update(model(), { t: "cycleLayer" });
    result = update(result.model, { t: "section", dir: 1 });
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
    let result = update(model(), { t: "cycleLayer" });
    result = update(result.model, { t: "section", dir: 1 });
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
    let result = update(model(), { t: "cycleLayer" });
    result = update(result.model, { t: "section", dir: 1 });
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
    const base = createInitialModel(sessionData, { layers: ["global", "project", "session"] });
    let result = update(base, { t: "move", delta: 2 });
    expect(result.model.cursor).toEqual({ section: "active", index: 2 });

    result = update(result.model, { t: "cycleLayer" });
    expect(result.model.layer).toBe("session");

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
    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], layer: "session", scope: "project" });
  });

  it("returns effects for async intents and records results", () => {
    let result = update(model(), { t: "diffPreview" });
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
});
