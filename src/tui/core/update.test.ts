import { describe, expect, it } from "vitest";
import { createInitialModel, type Model } from "./model.js";
import { update } from "./update.js";
import type { DashboardData } from "./data.js";

function model(): Model {
  return createInitialModel(data(), { mode: "filesystem", scope: "project" });
}

function data(): DashboardData {
  return {
    active: ["base", "data"],
    tools: ["claude-code", "opencode"],
    warnings: [],
    issues: [{ rowId: "project:data", text: "configuration drift" }],
    rows: [
      row("project:base", "base", "project", "active", "filesystem"),
      row("project:data", "data", "project", "drift", "filesystem", "configuration drift"),
      row("global:meta", "meta", "global", "available", null),
      row("project:bad", "bad", "project", "broken", null, "missing include"),
    ],
  };
}

function row(id: string, name: string, scope: "project" | "global", status: "active" | "available" | "drift" | "broken", activation: "filesystem" | null, issue?: string) {
  return {
    id,
    name,
    scope,
    description: `${name} description`,
    status,
    activation,
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

  it("toggles immediately and can undo the previous active set", () => {
    let result = update(model(), { t: "section", dir: 1 });
    result = update(result.model, { t: "toggle" });

    expect(result.effect).toEqual({ t: "apply", targetSet: ["meta"], mode: "filesystem", scope: "global" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.activation).toBe("filesystem");
    expect(result.model.undo?.targetSet).toEqual(["base", "data"]);

    result = update(result.model, { t: "undo" });
    expect(result.effect).toEqual({ t: "apply", targetSet: ["base", "data"], mode: "filesystem", scope: "project" });
    expect(result.model.rows.find((row) => row.id === "global:meta")?.activation).toBeNull();
  });

  it("returns effects for async intents and records results", () => {
    let result = update(model(), { t: "diffPreview" });
    expect(result.effect).toEqual({ t: "plan", targetSet: ["base", "data"], scope: "project" });
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
