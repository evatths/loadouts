import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import type { Intent } from "../../core/intent.js";
import type { SpecSpan, ViewSpec } from "../../core/viewspec.js";
import type { ThemeTokens } from "../../core/theme.js";
import { intentFromPiTuiInput } from "./input.js";
import { toPiTuiTheme, type PiTuiTheme } from "./theme.js";

export interface DashboardComponentOptions {
  spec: ViewSpec;
  theme?: ThemeTokens;
  onIntent?: (intent: Intent) => void;
}

export class PiTuiDashboard implements Component {
  private spec: ViewSpec;
  private theme: PiTuiTheme;
  private onIntent?: (intent: Intent) => void;

  constructor(options: DashboardComponentOptions) {
    this.spec = options.spec;
    this.theme = toPiTuiTheme(options.theme);
    this.onIntent = options.onIntent;
  }

  setSpec(spec: ViewSpec): void {
    this.spec = spec;
  }

  setTheme(theme: ThemeTokens): void {
    this.theme = toPiTuiTheme(theme);
  }

  render(width: number): string[] {
    return renderDashboard(this.spec, width, this.theme);
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

  constructor(spec: NonNullable<ViewSpec["overlay"]>, theme?: ThemeTokens, onIntent?: (intent: Intent) => void) {
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
    return renderOverlay(this.spec, width, this.theme);
  }

  handleInput(data: string): void {
    const intent = intentFromPiTuiInput(data);
    if (intent) this.onIntent?.(intent);
  }

  invalidate(): void {}
}

export function renderDashboard(spec: ViewSpec, width: number, theme: PiTuiTheme = toPiTuiTheme()): string[] {
  const safeWidth = Math.max(1, width);
  if (safeWidth < 42) return renderNarrow(spec, safeWidth, theme);

  const gap = 1;
  const leftWidth = clamp(Math.floor(safeWidth * 0.52), 34, Math.min(64, safeWidth - 24));
  const rightWidth = Math.max(12, safeWidth - leftWidth - gap);
  const left = renderLeft(spec, leftWidth, theme);
  const right = renderDetail(spec, rightWidth, theme);
  const bodyHeight = Math.max(left.length, right.length);
  const lines: string[] = [];

  for (let i = 0; i < bodyHeight; i++) {
    lines.push(fit(`${left[i] ?? blank(leftWidth)} ${right[i] ?? blank(rightWidth)}`, safeWidth));
  }

  lines.push(fit(spanLine(spec.footer.equipped, theme), safeWidth));
  lines.push(fit(spec.footer.keys.map((key) => theme.color.dim(`[${key.key}]`) + theme.color.muted(key.label)).join("  "), safeWidth));
  return lines.map((line) => fit(line, safeWidth));
}

function renderLeft(spec: ViewSpec, width: number, theme: PiTuiTheme): string[] {
  const lines = [topBorder(" LOADOUTS ", width, theme)];
  for (const pane of spec.panes) {
    lines.push(boxLine(theme.color.accent(`> ${pane.title}`), width, theme));
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

function renderDetail(spec: ViewSpec, width: number, theme: PiTuiTheme): string[] {
  const detail = spec.detail;
  const lines = [topBorder(` ${detail?.title ?? "Detail"} `, width, theme)];
  if (!detail) {
    lines.push(boxLine(theme.color.dim("No detail"), width, theme));
  } else {
    for (const block of detail.blocks) lines.push(boxLine(spanLine(block, theme), width, theme));
  }
  lines.push(bottomBorder(width, theme));
  return lines;
}

function renderNarrow(spec: ViewSpec, width: number, theme: PiTuiTheme): string[] {
  const lines: string[] = [fit(theme.color.accent("LOADOUTS"), width)];
  for (const pane of spec.panes) {
    lines.push(fit(theme.color.accent(`> ${pane.title}`), width));
    for (const row of pane.rows) {
      const glyph = theme.color[row.glyph.style](row.glyph.char);
      const cursor = row.selected ? ">" : " ";
      lines.push(fit(`${cursor} ${glyph} ${spanLine(row.spans, theme)}`, width));
    }
  }
  lines.push(fit(spanLine(spec.footer.equipped, theme), width));
  return lines;
}

export function renderOverlay(overlay: NonNullable<ViewSpec["overlay"]>, width: number, theme: PiTuiTheme): string[] {
  const boxWidth = clamp(width, 24, Math.min(82, width));
  const lines = [topBorder(` ${overlay.title} `, boxWidth, theme)];
  for (const line of overlay.lines) lines.push(boxLine(spanLine(line, theme), boxWidth, theme));
  lines.push(boxLine(theme.color.dim("esc to close"), boxWidth, theme));
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
