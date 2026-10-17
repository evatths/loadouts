import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardController } from "./controller.js";
import { loadDashboardData, type DashboardData, type LoadoutRow } from "./data.js";
import { cursorRow } from "./selection.js";

vi.mock("./data.js", async (original) => ({ ...await original<typeof import("./data.js")>(), loadDashboardData: vi.fn() }));

function row(name: string, scope: "global" | "project" = "project"): LoadoutRow {
  return { id: `${scope}:${name}`, name, scope, equipped: [], status: "available", counts: { rules: 0, skills: 0, instructions: 0, extensions: 0 }, tools: [], slots: [] };
}
const data = (rows: LoadoutRow[]): DashboardData => ({ rows, active: [], tools: [], issues: [], warnings: [] });

describe("controller navigation across refresh", () => {
  beforeEach(() => vi.mocked(loadDashboardData).mockReset());

  it("preserves row identity on reorder and repairs selection after a row disappears", async () => {
    const exit = vi.fn();
    const controller = new DashboardController({ cwd: "/fixture", changed: vi.fn(), exit, edit: vi.fn() });
    vi.mocked(loadDashboardData).mockResolvedValue(data([row("a", "global"), row("b"), row("c")]));
    await controller.refresh();
    await controller.dispatch({ t: "cycleScope", dir: -1 });
    await controller.dispatch({ t: "edge", edge: "last" });
    expect(cursorRow(controller.model)?.name).toBe("c");
    vi.mocked(loadDashboardData).mockResolvedValue(data([row("c"), row("a", "global"), row("b")]));
    await controller.refresh();
    expect(cursorRow(controller.model)?.name).toBe("c");
    expect(controller.model.filter.scope).toBe("project");
    vi.mocked(loadDashboardData).mockResolvedValue(data([row("b")]));
    await controller.refresh();
    expect(cursorRow(controller.model)?.name).toBe("b");
    await controller.dispatch({ t: "closeOverlay" });
    expect(controller.model.filter.scope).toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
    await controller.dispatch({ t: "closeOverlay" });
    expect(exit).toHaveBeenCalledOnce();
  });
});
