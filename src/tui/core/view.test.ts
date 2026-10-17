import { describe, expect, it } from "vitest";
import { createInitialModel, type EquipLayer, type Model } from "./model.js";
import { view } from "./view.js";
import type { DashboardData } from "./data.js";
import { update } from "./update.js";

describe("view", () => {
  it("renders active, available, issue, detail, and equipped states", () => {
    expect(compact(view(model()))).toMatchInlineSnapshot(`
      {
        "detail": {
          "blocks": [
            "scope: project",
            "equipped: project",
            "action target: project",
            "status: active",
            ""base description"",
            "Artifacts (press enter to expand)",
            "rule         rules/base.md -> claude-code",
            "instruction  AGENTS.base.md -> claude-code, opencode",
            "skill        skills/debug -> opencode",
          ],
          "title": "base",
        },
        "equipped": "EQUIPPED: G —  P base·data  S —  [filesystem] drift  1 issue(s) detected",
        "overlay": undefined,
        "panes": [
          {
            "rows": [
              "*✓ base  project  1 rule  1 skill  1 instr  [P]",
              " ~ data  project  1 rule  [P]  configuration drift",
            ],
            "title": "1 Active (2)",
          },
          {
            "rows": [
              " - meta  global  1 rule",
            ],
            "title": "2 Available (1)",
          },
          {
            "rows": [
              " ! bad  project  1 rule  missing include",
            ],
            "title": "3 Issues (1)",
          },
        ],
      }
    `);
  });

  it("shows the selected scope and contextual action hints", () => {
    let next = model();
    expect(view(next).tabs.find((span) => span.style === "accent")?.text).toContain("[All]");
    expect(view(next).footer.keys.map((hint) => hint.key)).toContain("d");
    expect(view(next).footer.keys.map((hint) => hint.key)).not.toContain("a");
    expect(view(next).footer.keys.map((hint) => hint.key)).not.toContain("m");
    next = update(next, { t: "cycleScope", dir: 1 }).model;
    expect(view(next).tabs.find((span) => span.style === "accent")?.text).toContain("[Global]");
    expect(view(next).footer.keys.map((hint) => hint.key)).toContain("a");
    next = update(next, { t: "closeOverlay" }).model;
    next = update(next, { t: "selectSection", section: "issues" }).model;
    const keys = view(next).footer.keys.map((hint) => hint.key);
    expect(keys).not.toContain("a");
    expect(keys).not.toContain("d");
    expect(keys).not.toContain("space");
    expect(keys).toContain("h/l");
    expect(keys).toContain("[/]");
  });

  it("renders filtered, expanded detail, help, diff, and empty states", () => {
    let filtered = model();
    filtered = { ...filtered, filter: { text: "meta" }, filtering: true, cursor: { section: "available", index: 0 } };
    expect(compact(view(filtered))).toMatchInlineSnapshot(`
      {
        "detail": {
          "blocks": [
            "scope: global",
            "equipped: —",
            "action target: global",
            "status: available",
            ""meta description"",
            "Artifacts (press enter to expand)",
            "rule         rules/meta.md -> claude-code",
          ],
          "title": "meta",
        },
        "equipped": "EQUIPPED: G —  P base·data  S —  [filesystem] drift  1 issue(s) detected  /meta",
        "overlay": undefined,
        "panes": [
          {
            "rows": [],
            "title": "1 Active (0)",
          },
          {
            "rows": [
              "*- meta  global  1 rule",
            ],
            "title": "2 Available (1)",
          },
          {
            "rows": [],
            "title": "3 Issues (0)",
          },
        ],
      }
    `);

    const expanded = { ...model(), detail: { rowId: "project:base" } };
    expect(compact(view(expanded)).detail?.blocks).toContain("Artifacts (slots)");

    const help = { ...model(), overlay: "help" as const };
    expect(view(help).overlay).toMatchObject({ kind: "help", title: "Keymap" });
    expect(view(help).overlay?.lines.map((line) => line.map((span) => span.text).join(""))).toContain("printable filter text");

    const diff = { ...model(), overlay: "diff" as const, diffLines: ["+ rule x", "~ skill y"] };
    expect(view(diff).overlay?.lines.map((line) => line.map((span) => span.text).join(""))).toEqual(["+ rule x", "~ skill y"]);

    expect(compact(view(createInitialModel({ rows: [], active: [], tools: [], issues: [], warnings: [] })))).toMatchInlineSnapshot(`
      {
        "detail": {
          "blocks": [
            "No loadouts found. Run \`loadouts init\` to get started.",
          ],
          "title": "Loadouts",
        },
        "equipped": "EQUIPPED: G —  P —  S —  [filesystem] in sync",
        "overlay": undefined,
        "panes": [
          {
            "rows": [],
            "title": "1 Active (0)",
          },
          {
            "rows": [],
            "title": "2 Available (0)",
          },
          {
            "rows": [],
            "title": "3 Issues (0)",
          },
        ],
      }
    `);
  });
});

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
    counts: { rules: 1, skills: name === "base" ? 1 : 0, instructions: name === "base" ? 1 : 0, extensions: 0 },
    tools: ["claude-code", "opencode"],
    issue,
    slots: [
      { kind: "rule", name: `${name}-rule`, relativePath: `rules/${name}.md`, tools: ["claude-code"] },
      ...(name === "base" ? [{ kind: "instruction", name: "AGENTS.base.md", relativePath: "AGENTS.base.md", tools: ["claude-code", "opencode"] }] : []),
      ...(name === "base" ? [{ kind: "skill", name: "debug", relativePath: "skills/debug", tools: ["opencode"] }] : []),
    ],
  };
}

function compact(spec: ReturnType<typeof view>) {
  return {
    panes: spec.panes.map((pane) => ({
      title: pane.title,
      rows: pane.rows.map((row) => `${row.selected ? "*" : " "}${row.glyph.char} ${row.spans.map((span) => span.text).join("")}`),
    })),
    detail: spec.detail && {
      title: spec.detail.title,
      blocks: spec.detail.blocks.map((block) => block.map((span) => span.text).join("")),
    },
    equipped: spec.footer.equipped.map((span) => span.text).join("").trim(),
    overlay: spec.overlay,
  };
}
