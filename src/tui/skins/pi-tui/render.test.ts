import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createInitialModel } from "../../core/model.js";
import { view } from "../../core/view.js";
import { renderDashboard, renderOverlay } from "./render.js";
import type { DashboardData } from "../../core/data.js";
import { update } from "../../core/update.js";

describe("pi-tui render skin", () => {
  it("renders a dashboard ViewSpec without exceeding width", () => {
    const data: DashboardData = {
      active: ["backend-py"],
      tools: ["claude-code", "cursor", "opencode"],
      issues: [],
      warnings: [],
      rows: [
        {
          id: "project:backend-py",
          name: "backend-py",
          scope: "project",
          description: "Python backend conventions",
          status: "active",
          equipped: ["project"],
          counts: { rules: 3, skills: 1, instructions: 0, extensions: 0 },
          tools: ["claude-code", "cursor", "opencode"],
          filePath: "/tmp/backend-py.yaml",
          slots: [
            { kind: "rule", name: "py-style", relativePath: "rules/py-style.md", tools: ["claude-code", "cursor"] },
            { kind: "skill", name: "pytest-run", relativePath: "skills/pytest-run", tools: ["opencode"] },
          ],
        },
        {
          id: "project:frontend-react",
          name: "frontend-react-with-a-long-name-that-must-truncate",
          scope: "project",
          status: "available",
          equipped: [],
          counts: { rules: 1, skills: 0, instructions: 1, extensions: 0 },
          tools: ["cursor", "opencode"],
          slots: [],
        },
      ],
    };

    const lines = renderDashboard(view(createInitialModel(data)), 80);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  it("keeps the selected row and navigation visible at the end of a long list and after resize", () => {
    const data: DashboardData = {
      active: [], tools: [], issues: [], warnings: [],
      rows: Array.from({ length: 120 }, (_, index) => ({
        id: `project:row-${index}`, name: `row-${index}`, scope: "project", status: "available", equipped: [],
        counts: { rules: 0, skills: 0, instructions: 0, extensions: 0 }, tools: [], slots: [],
      })),
    };
    let model = createInitialModel(data);
    model = update(model, { t: "edge", edge: "last" }).model;
    for (const [width, height] of [[100, 24], [80, 14], [42, 12], [35, 10]]) {
      const lines = renderDashboard(view(model), width, undefined, height);
      expect(lines.length).toBeLessThanOrEqual(height);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.join("\n")).toContain("row-119");
      expect(lines.join("\n")).toContain("[All]");
      expect(lines.join("\n")).toContain("section");
    }
    const help = view(update(model, { t: "openHelp" }).model).overlay!;
    expect(renderOverlay(help, 60, undefined, 12).length).toBeLessThanOrEqual(12);
    const bottom = renderOverlay({ ...help, scroll: help.lines.length }, 60, undefined, 12).join("\n");
    expect(bottom).toContain("cancel filter");
  });

  it("makes the last artifact accessible through detail paging", () => {
    const data: DashboardData = {
      active: [], tools: [], issues: [], warnings: [],
      rows: [{ id: "project:many", name: "many", scope: "project", status: "available", equipped: [],
        counts: { rules: 50, skills: 0, instructions: 0, extensions: 0 }, tools: [],
        slots: Array.from({ length: 50 }, (_, index) => ({ kind: "rule", name: `r-${index}`, relativePath: `r-${index}`, tools: [] })),
      }],
    };
    let model = createInitialModel(data);
    for (let i = 0; i < 12; i++) model = update(model, { t: "detailScroll", delta: 5 }).model;
    const lines = renderDashboard(view(model), 100, undefined, 16);
    expect(lines.length).toBeLessThanOrEqual(16);
    expect(lines.join("\n")).toContain("r-49");
    expect(lines.join("\n")).toContain("pgup/pgdn");
  });
});
