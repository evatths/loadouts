import { footerKeyHints, keymap } from "./keymap.js";
import type { Model, Section } from "./model.js";
import type { LoadoutRow } from "./data.js";
import type { SpecPane, SpecSpan, ViewSpec } from "./viewspec.js";
import type { StyleToken } from "./theme.js";
import { cursorRow, rowLayer, SCOPES, sessionScope, visibleRows } from "./selection.js";

const SECTIONS: Array<{ id: Section; title: string }> = [
  { id: "active", title: "Active" },
  { id: "available", title: "Available" },
  { id: "issues", title: "Issues" },
];

export function view(model: Model): ViewSpec {
  const panes = SECTIONS.map(({ id, title }) => pane(model, id, title));
  const row = cursorRow(model);
  return {
    tabs: [
      ...SCOPES.map((scope): SpecSpan => ({ text: `${model.filter.scope === scope ? "[" : " "}${scope ? scope[0].toUpperCase() + scope.slice(1) : "All"}${model.filter.scope === scope ? "]" : " "} `, style: model.filter.scope === scope ? "accent" : "muted" })),
      { text: " ‹ [ / ] ›", style: "dim" },
    ],
    mode: [
      { text: `MODE: ${model.mode}`, style: "accent" },
      { text: model.sessionAvailable ? "  m switch" : "", style: "dim" },
      { text: model.mode === "filesystem" ? "  · row scope → destination" : `  · source: ${sessionScope(model)}`, style: "muted" },
    ],
    panes,
    detail: row ? { ...detail(row, model.detail?.rowId === row.id, rowLayer(model, row)), scroll: model.detail?.rowId === row.id ? model.detail.scroll : 0 } : emptyDetail(model),
    footer: { equipped: equipped(model), keys: footerKeyHints(model), filter: { active: model.filtering, text: model.filter.text } },
    overlay: overlay(model),
  };
}

function pane(model: Model, section: Section, title: string): SpecPane {
  const rows = visibleRows(model, section);
  return {
    title: `${SECTIONS.findIndex((item) => item.id === section) + 1} ${title} (${rows.length})`,
    focused: model.cursor.section === section,
    rows: rows.map((row, index) => ({
      id: row.id,
      glyph: glyph(row),
      spans: rowSpans(row),
      selected: model.cursor.section === section && model.cursor.index === index,
    })),
  };
}

function detail(row: LoadoutRow, expanded: boolean, target: string) {
  const blocks: SpecSpan[][] = [
    kv("scope", row.scope),
    kv("equipped", row.equipped.join(" / ") || "—"),
    kv("action target", target),
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
      scroll: model.overlayScroll,
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
      scroll: model.overlayScroll,
      lines: (model.diffLines?.length ? model.diffLines : [model.busy?.label ?? "No diff loaded"]).map((line) => [{ text: line, style: lineStyle(line) }]),
    };
  }
  if (model.overlay === "confirm" && model.confirm) {
    const action = model.confirm.action === "diffPreview" ? "Diff" : model.confirm.action === "sync" ? "Sync" : "Clear";
    return {
      kind: "confirm", title: `${action} · choose scope`,
      lines: [
        [{ text: "Which filesystem scope?", style: "text" }],
        ...(["global", "project"] as const).map((scope): SpecSpan[] => [{ text: `${model.confirm?.scope === scope ? "▸" : " "} ${scope}`, style: model.confirm?.scope === scope ? "accent" : "muted" }]),
        [{ text: `${action} all equipped loadouts in ${model.confirm.scope}.`, style: "warning" }],
        [{ text: "h/l or j/k choose · enter confirms", style: "dim" }],
      ],
    };
  }
  return undefined;
}

function equipped(model: Model): SpecSpan[] {
  const active = model.rows.filter((row) => row.equipped.length);
  const drift = active.some((row) => row.status === "drift");
  return [
    { text: "EQUIPPED: ", style: "accent" },
    ...(["global", "project", "session"] as const).map((layer): SpecSpan => ({
      text: `${layer[0].toUpperCase()} ${active.filter((row) => row.equipped.includes(layer)).map((row) => row.name).join("·") || "—"}  `,
      style: (model.mode === "session" ? layer === "session" : layer !== "session") ? "accent" : "muted",
    })),
    { text: `[${model.mode}] `, style: "dim" },
    { text: drift ? "drift" : "in sync", style: drift ? "warning" : "success" },
    ...(model.busy ? [{ text: `  ${model.busy.label}…`, style: "warning" as const }] : []),
    ...(model.lastResult ? [{ text: `  ${model.lastResult.text}`, style: model.lastResult.variant === "error" ? "error" as const : "muted" as const }] : []),
    ...(model.filtering || model.filter.text
      ? [
          { text: "  /", style: "accent" as const },
          { text: model.filter.text || " ", style: model.filter.text ? "text" as const : "dim" as const },
        ]
      : []),
    ...(model.filter.tool ? [{ text: `  tool:${model.filter.tool}`, style: "accent" as const }] : []),
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
    { text: row.name, style: row.equipped.length ? "success" : "text" },
    { text: `  ${row.scope}`, style: "dim" },
    { text: `  ${counts}`, style: "muted" },
    ...(row.equipped.length ? [{ text: `  [${row.equipped.map((layer) => layer[0].toUpperCase()).join("/")}]`, style: "accent" as const }] : []),
    ...(row.issue ? [{ text: `  ${row.issue}`, style: "warning" as const }] : []),
  ];
}

function glyph(row: LoadoutRow): { char: string; style: StyleToken } {
  if (row.status === "broken") return { char: "!", style: "error" };
  if (row.status === "drift") return { char: "~", style: "warning" };
  if (row.equipped.length) return { char: "✓", style: "success" };
  return { char: "-", style: "dim" };
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
