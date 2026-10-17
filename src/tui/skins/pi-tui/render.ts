import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Intent } from "../../core/intent.js";
import type { SpecSpan, ViewSpec } from "../../core/viewspec.js";
import type { ThemeTokens } from "../../core/theme.js";
import { intentFromPiTuiInput } from "./input.js";
import { toPiTuiTheme, type PiTuiTheme } from "./theme.js";
import { windowLines, windowPanes } from "../../core/viewport.js";

export interface DashboardComponentOptions {
  spec: ViewSpec;
  theme?: ThemeTokens;
  onIntent?: (intent: Intent) => void;
  height?: () => number;
}

export class PiTuiDashboard implements Component {
  private spec: ViewSpec;
  private theme: PiTuiTheme;
  private onIntent?: (intent: Intent) => void;
  private height: () => number;

  constructor(options: DashboardComponentOptions) {
    this.spec = options.spec;
    this.theme = toPiTuiTheme(options.theme);
    this.onIntent = options.onIntent;
    this.height = options.height ?? (() => 24);
  }

  setSpec(spec: ViewSpec): void {
    this.spec = spec;
  }

  setTheme(theme: ThemeTokens): void {
    this.theme = toPiTuiTheme(theme);
  }

  render(width: number): string[] {
    return renderDashboard(this.spec, width, this.theme, this.height());
  }

  handleInput(data: string): void {
    const intent = intentFromPiTuiInput(data, this.spec);
    if (intent) this.onIntent?.(intent);
  }

  invalidate(): void {}
}

export class PiTuiOverlay implements Component {
  private spec: NonNullable<ViewSpec["overlay"]>;
  private theme: PiTuiTheme;
  private onIntent?: (intent: Intent) => void;

  constructor(spec: NonNullable<ViewSpec["overlay"]>, theme?: ThemeTokens, onIntent?: (intent: Intent) => void, private height: () => number = () => 24) {
    this.spec = spec;
    this.theme = toPiTuiTheme(theme);
    this.onIntent = onIntent;
  }

  setSpec(spec: NonNullable<ViewSpec["overlay"]>): void {
    this.spec = spec;
  }

  setTheme(theme: ThemeTokens): void {
    this.theme = toPiTuiTheme(theme);
  }

  render(width: number): string[] {
    return renderOverlay(this.spec, width, this.theme, this.height());
  }

  handleInput(data: string): void {
    const intent = intentFromPiTuiInput(data);
    if (intent) this.onIntent?.(intent);
  }

  invalidate(): void {}
}

export function renderDashboard(spec: ViewSpec, width: number, theme: PiTuiTheme = toPiTuiTheme(), height = 24): string[] {
  const safeWidth = Math.max(1, width);
  if (safeWidth < 42 || height < 12) return renderNarrow(spec, safeWidth, theme, height);

  const gap = 1;
  const leftWidth = clamp(Math.floor(safeWidth * 0.52), 20, Math.min(64, safeWidth - 20));
  const rightWidth = Math.max(12, safeWidth - leftWidth - gap);
  const left = renderLeft(spec, leftWidth, theme, height - 4);
  const right = renderDetail(spec, rightWidth, theme, height - 4);
  const bodyHeight = Math.max(left.length, right.length);
  const lines: string[] = [fit(spanLine(spec.tabs, theme), safeWidth), fit(spanLine(spec.mode, theme), safeWidth)];

  for (let i = 0; i < bodyHeight; i++) {
    lines.push(fit(`${left[i] ?? blank(leftWidth)} ${right[i] ?? blank(rightWidth)}`, safeWidth));
  }

  lines.push(fit(spanLine(spec.footer.equipped, theme), safeWidth));
  lines.push(fit(spec.footer.keys.map((key) => theme.color.dim(key.key === "[/]" ? "[ / ]" : `[${key.key}]`) + theme.color.muted(` ${key.label}`)).join("  "), safeWidth));
  return lines.map((line) => fit(line, safeWidth));
}

function renderLeft(spec: ViewSpec, width: number, theme: PiTuiTheme, height: number): string[] {
  const lines = [topBorder(" LOADOUTS ", width, theme)];
  for (const pane of windowPanes(spec.panes, height - 2)) {
    lines.push(boxLine(theme.color[pane.focused ? "accent" : "muted"](`${pane.focused ? ">" : " "} ${pane.title}`), width, theme));
    if (pane.rows.length === 0) {
      lines.push(boxLine(theme.color.dim("  -- empty --"), width, theme));
      continue;
    }
    for (const row of pane.rows) {
      const glyph = theme.color[row.glyph.style](row.glyph.char);
      const cursor = row.selected ? theme.color.accent(">") : " ";
      const text = `${cursor} ${glyph} ${spanLine(row.spans, theme)}`;
      lines.push(boxLine(row.selected ? theme.selected(padTo(text, width - 4)) : text, width, theme));
    }
  }
  lines.push(bottomBorder(width, theme));
  return lines;
}

function renderDetail(spec: ViewSpec, width: number, theme: PiTuiTheme, height: number): string[] {
  const detail = spec.detail;
  const lines = [topBorder(` ${detail?.title ?? "Detail"} `, width, theme)];
  if (!detail) {
    lines.push(boxLine(theme.color.dim("No detail"), width, theme));
  } else {
    const count = Math.max(1, height - 3);
    for (const block of windowLines(detail.blocks, count, detail.scroll)) lines.push(boxLine(spanLine(block, theme), width, theme));
    lines.push(boxLine(theme.color.dim("pgup/pgdn scroll details"), width, theme));
  }
  lines.push(bottomBorder(width, theme));
  return lines;
}

function renderNarrow(spec: ViewSpec, width: number, theme: PiTuiTheme, height: number): string[] {
  const lines: string[] = [fit(spanLine(spec.tabs, theme), width), fit(spanLine(spec.mode, theme), width)];
  for (const pane of windowPanes(spec.panes, height - 4)) {
    lines.push(fit(theme.color[pane.focused ? "accent" : "muted"](`${pane.focused ? ">" : " "} ${pane.title}`), width));
    for (const row of pane.rows) {
      const glyph = theme.color[row.glyph.style](row.glyph.char);
      const cursor = row.selected ? ">" : " ";
      lines.push(fit(`${cursor} ${glyph} ${spanLine(row.spans, theme)}`, width));
    }
  }
  lines.push(fit(spanLine(spec.footer.equipped, theme), width));
  lines.push(fit(spec.footer.keys.map((key) => `${key.key} ${key.label}`).join("  "), width));
  return lines.slice(0, Math.max(1, height));
}

export function renderOverlay(overlay: NonNullable<ViewSpec["overlay"]>, width: number, theme: PiTuiTheme = toPiTuiTheme(), height = 24): string[] {
  const boxWidth = clamp(width, 24, Math.min(82, width));
  const lines = [topBorder(` ${overlay.title} `, boxWidth, theme)];
  for (const line of windowLines(overlay.lines, height - 3, overlay.scroll)) lines.push(boxLine(spanLine(line, theme), boxWidth, theme));
  lines.push(boxLine(theme.color.dim(overlay.kind === "confirm" ? "h/l choose · enter confirm · esc cancel" : "j/k scroll · esc to close"), boxWidth, theme));
  lines.push(bottomBorder(boxWidth, theme));
  return lines.map((line) => fit(line, boxWidth));
}

function spanLine(spans: SpecSpan[], theme: PiTuiTheme): string {
  return spans.map((span) => theme.color[span.style ?? "text"](span.text)).join("");
}

function topBorder(title: string, width: number, theme: PiTuiTheme): string {
  const inner = Math.max(0, width - 2);
  const clippedTitle = truncateToWidth(title, inner, "", false);
  const rest = Math.max(0, inner - visibleWidth(clippedTitle));
  return theme.color.border(`+${clippedTitle}${"-".repeat(rest)}+`);
}

function bottomBorder(width: number, theme: PiTuiTheme): string {
  return theme.color.border(`+${"-".repeat(Math.max(0, width - 2))}+`);
}

function boxLine(line: string, width: number, theme: PiTuiTheme): string {
  const inner = Math.max(0, width - 4);
  return fit(`${theme.color.border("| ")}${fit(line, inner)}${theme.color.border(" |")}`, width);
}

function fit(line: string, width: number): string {
  return truncateToWidth(line, Math.max(0, width), "...", true);
}

function padTo(line: string, width: number): string {
  const clipped = truncateToWidth(line, Math.max(0, width), "...");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function blank(width: number): string {
  return " ".repeat(Math.max(0, width));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
