import type { StyleToken } from "./theme.js";

export interface SpecSpan {
  text: string;
  style?: StyleToken;
}

export interface SpecRow {
  id: string;
  glyph: { char: string; style: StyleToken };
  spans: SpecSpan[];
  selected: boolean;
}

export interface SpecPane {
  title: string;
  rows: SpecRow[];
}

export interface SpecDetail {
  title: string;
  blocks: SpecSpan[][];
}

export interface SpecFooter {
  equipped: SpecSpan[];
  keys: { key: string; label: string }[];
  filter?: { active: boolean; text: string };
}

export interface ViewSpec {
  panes: SpecPane[];
  detail?: SpecDetail;
  footer: SpecFooter;
  overlay?: {
    kind: "help" | "diff" | "confirm";
    title: string;
    lines: SpecSpan[][];
  };
}
