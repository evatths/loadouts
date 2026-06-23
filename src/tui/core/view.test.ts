import { describe, expect, it } from "vitest";
import { createInitialModel, type Model } from "./model.js";
import { view } from "./view.js";
import type { DashboardData } from "./data.js";

describe("view", () => {
  it("renders active, available, issue, detail, and equipped states", () => {
    expect(compact(view(model()))).toMatchInlineSnapshot(`
      {
        "detail": {
          "blocks": [
            "scope: project",
            "status: active",
            "\"base description\"",
            "Artifacts (press enter to expand)",
            "rule         rules/base.md -> claude-code",
            "instruction  AGENTS.base.md -> claude-code, opencode",
            "skill        skills/debug -> opencode",
          ],
          "title": "base",
        },
        "equipped": "EQUIPPED: base + data -> claude-code, opencode [fs] drift",
        "overlay": undefined,
        "panes": [
          {
            "rows": [
              "*✓ base  project  1 rule  1 skill  1 instr  [fs]",
              " ~ data  project  1 rule  [fs]  configuration drift",
            ],
            "title": "Active (2)",
          },
          {
            "rows": [
              " - meta  global  1 rule",
            ],
            "title": "Available (1)",
          },
          {
            "rows": [
              " ! bad  project  1 rule  missing include",
            ],
            "title": "Issues (1)",
          },
        ],
      }
    `);
  });

  it("renders filtered, expanded detail, help, diff, and empty states", () => {
    let filtered = model();
    filtered = { ...filtered, filter: { text: "meta" }, filtering: true, cursor: { section: "available", index: 0 } };
    expect(compact(view(filtered))).toMatchInlineSnapshot(`
      {
        "detail": {
          "blocks": [
            "scope: global",
            "status: available",
            "\"meta description\"",
            "Artifacts (press enter to expand)",
            "rule         rules/meta.md -> claude-code",
          ],
          "title": "meta",
        },
        "equipped": "EQUIPPED: base + data -> claude-code, opencode [fs] drift  /meta",
        "overlay": undefined,
        "panes": [
          {
            "rows": [],
            "title": "Active (0)",
          },
          {
            "rows": [
              "*- meta  global  1 rule",
            ],
            "title": "Available (1)",
          },
          {
            "rows": [],
            "title": "Issues (0)",
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
        "equipped": "EQUIPPED: none -> no tools [fs] in sync",
        "overlay": undefined,
        "panes": [
          {
            "rows": [],
            "title": "Active (0)",
          },
          {
            "rows": [],
            "title": "Available (0)",
          },
          {
            "rows": [],
            "title": "Issues (0)",
          },
        ],
      }
    `);
  });
});

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
