import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createInitialModel } from "../../core/model.js";
import { view } from "../../core/view.js";
import { renderDashboard } from "./render.js";
import type { DashboardData } from "../../core/data.js";

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
          activation: "filesystem",
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
          activation: null,
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
});
