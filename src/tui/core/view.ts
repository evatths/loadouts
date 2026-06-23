import { footerKeyHints, keymap } from "./keymap.js";
import type { Model, Section } from "./model.js";
import type { LoadoutRow } from "./data.js";
import type { SpecPane, SpecSpan, ViewSpec } from "./viewspec.js";
import type { StyleToken } from "./theme.js";

const SECTIONS: Array<{ id: Section; title: string }> = [
  { id: "active", title: "Active" },
  { id: "available", title: "Available" },
  { id: "issues", title: "Issues" },
];

export function view(model: Model): ViewSpec {
  const panes = SECTIONS.map(({ id, title }) => pane(model, id, title));
  const row = cursorRow(model);
  return {
    panes,
    detail: row ? detail(row, model.detail?.rowId === row.id) : emptyDetail(model),
    footer: { equipped: equipped(model), keys: footerKeyHints(), filter: { active: model.filtering, text: model.filter.text } },
    overlay: overlay(model),
  };
}

function pane(model: Model, section: Section, title: string): SpecPane {
  const rows = visibleRows(model, section);
  return {
    title: `${title} (${rows.length})`,
    rows: rows.map((row, index) => ({
      id: row.id,
      glyph: glyph(row),
      spans: rowSpans(row),
      selected: model.cursor.section === section && model.cursor.index === index,
    })),
  };
}

function detail(row: LoadoutRow, expanded: boolean) {
  const blocks: SpecSpan[][] = [
    kv("scope", row.scope),
    kv("status", row.issue ? `${row.status}: ${row.issue}` : row.status),
  ];
  if (row.description) blocks.push([{ text: `"${row.description}"`, style: "muted" }]);
  blocks.push([{ text: expanded ? "Artifacts (slots)" : "Artifacts (press enter to expand)", style: "accent" }]);
  for (const slot of (expanded ? row.slots : row.slots.slice(0, 5))) {
    blocks.push([
      { text: artifactKindColumn(slot.kind), style: "dim" },
      { text: slot.relativePath, style: "text" },
      { text: " -> ", style: "dim" },
      { text: slot.tools.length ? slot.tools.join(", ") : "—", style: slot.tools.length ? "muted" : "dim" },
    ]);
  }
  if (!expanded && row.slots.length > 5) blocks.push([{ text: `+${row.slots.length - 5} more`, style: "dim" }]);
  return { title: row.name, blocks };
}

function emptyDetail(model: Model) {
  return {
    title: "Loadouts",
    blocks: model.rows.length
      ? [[{ text: "No rows match the current filter", style: "muted" as const }]]
      : [[{ text: "No loadouts found. Run `loadouts init` to get started.", style: "muted" as const }]],
  };
}

function overlay(model: Model): ViewSpec["overlay"] {
  if (model.overlay === "help") {
    return {
      kind: "help",
      title: "Keymap",
      lines: keymap.map((binding) => [
        { text: binding.keys.join("/"), style: "accent" },
        { text: ` ${binding.label}`, style: "text" },
      ]),
    };
  }
  if (model.overlay === "diff") {
    return {
      kind: "diff",
      title: model.busy ? "Diff (loading)" : "Diff",
      lines: (model.diffLines?.length ? model.diffLines : [model.busy?.label ?? "No diff loaded"]).map((line) => [{ text: line, style: lineStyle(line) }]),
    };
  }
  if (model.overlay === "confirm") return { kind: "confirm", title: "Confirm", lines: [[{ text: "Press enter to confirm", style: "warning" }]] };
  return undefined;
}

function equipped(model: Model): SpecSpan[] {
  const active = model.rows.filter((row) => row.activation);
  const names = active.map((row) => row.name).join(" + ") || "none";
  const tools = Array.from(new Set(active.flatMap((row) => row.tools))).sort().join(", ") || "no tools";
  const drift = active.some((row) => row.status === "drift");
  return [
    { text: "EQUIPPED: ", style: "accent" },
    { text: names, style: active.length ? "success" : "dim" },
    { text: ` -> ${tools} `, style: "muted" },
    { text: `[${model.mode === "runtime" ? "session" : "fs"}] `, style: "dim" },
    { text: drift ? "drift" : "in sync", style: drift ? "warning" : "success" },
    ...(model.filtering || model.filter.text
      ? [
          { text: "  /", style: "accent" as const },
          { text: model.filter.text || " ", style: model.filter.text ? "text" as const : "dim" as const },
        ]
      : []),
  ];
}

function artifactKindColumn(kind: string): string {
  return `${kind.padEnd(11)}  `;
}

function rowSpans(row: LoadoutRow): SpecSpan[] {
  const counts = [
    count(row.counts.rules, "rule"),
    count(row.counts.skills, "skill"),
    count(row.counts.instructions, "instr"),
    count(row.counts.extensions, "ext"),
  ].filter(Boolean).join("  ") || "empty";
  return [
    { text: row.name, style: row.activation ? "success" : "text" },
    { text: `  ${row.scope}`, style: "dim" },
    { text: `  ${counts}`, style: "muted" },
    ...(row.activation ? [{ text: `  [${row.activation === "runtime" ? "session" : "fs"}]`, style: "accent" as const }] : []),
    ...(row.issue ? [{ text: `  ${row.issue}`, style: "warning" as const }] : []),
  ];
}

function glyph(row: LoadoutRow): { char: string; style: StyleToken } {
  if (row.status === "broken") return { char: "!", style: "error" };
  if (row.status === "drift") return { char: "~", style: "warning" };
  if (row.activation) return { char: "✓", style: "success" };
  return { char: "-", style: "dim" };
}

function visibleRows(model: Model, section: Section): LoadoutRow[] {
  return model.sections[section]
    .map((id) => model.rows.find((row) => row.id === id))
    .filter((row): row is LoadoutRow => Boolean(row))
    .filter((row) => {
      if (model.filter.scope && row.scope !== model.filter.scope) return false;
      if (model.filter.tool && !row.tools.includes(model.filter.tool)) return false;
      const text = model.filter.text.trim().toLowerCase();
      return !text || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(text);
    });
}

function cursorRow(model: Model): LoadoutRow | undefined {
  return visibleRows(model, model.cursor.section)[model.cursor.index];
}

function kv(key: string, value: string): SpecSpan[] {
  return [{ text: `${key}: `, style: "dim" }, { text: value, style: "text" }];
}

function count(n: number, label: string): string {
  return n === 0 ? "" : `${n} ${label}${n === 1 ? "" : "s"}`;
}

function lineStyle(line: string): StyleToken {
  return line.startsWith("!") ? "error" : line.startsWith("~") ? "warning" : line.startsWith("+") ? "success" : "text";
}
