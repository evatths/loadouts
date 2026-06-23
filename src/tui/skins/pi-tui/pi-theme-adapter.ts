import type { Theme } from "@earendil-works/pi-coding-agent";
import type { StyleToken } from "../../core/theme.js";
import type { PiTuiTheme } from "./theme.js";

const TOKEN_MAP: Record<StyleToken, Parameters<Theme["fg"]>[0]> = {
  text: "text",
  muted: "muted",
  dim: "dim",
  accent: "accent",
  success: "success",
  error: "error",
  warning: "warning",
  border: "border",
};

export function piHostThemeToPiTuiTheme(theme: Theme): PiTuiTheme {
  return {
    color: {
      text: (text) => theme.fg(TOKEN_MAP.text, text),
      muted: (text) => theme.fg(TOKEN_MAP.muted, text),
      dim: (text) => theme.fg(TOKEN_MAP.dim, text),
      accent: (text) => theme.fg(TOKEN_MAP.accent, text),
      success: (text) => theme.fg(TOKEN_MAP.success, text),
      error: (text) => theme.fg(TOKEN_MAP.error, text),
      warning: (text) => theme.fg(TOKEN_MAP.warning, text),
      border: (text) => theme.fg(TOKEN_MAP.border, text),
    },
    selected: (text) => theme.bg("selectedBg", text),
    background: (text) => text,
  };
}
