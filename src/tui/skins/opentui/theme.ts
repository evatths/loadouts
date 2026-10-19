import type { Plugin } from "@opencode/plugin/tui";
import type { RGBA } from "@opentui/core";
import { defaultThemeTokens, type StyleToken, type ThemeTokens } from "../../core/theme.js";

export type OpenTuiColor = string | RGBA;

export type OpenTuiThemeTokens = Record<StyleToken, OpenTuiColor> & {
  background?: OpenTuiColor;
  selectedBackground?: OpenTuiColor;
};

export function toOpenTuiTheme(theme?: Plugin.Context["theme"]): OpenTuiThemeTokens {
  if (!theme) return defaultThemeTokens;
  return {
    text: theme.text.base,
    muted: theme.text.muted,
    dim: theme.text.faint,
    accent: theme.text.action.primary.base,
    success: theme.text.feedback.success.base,
    error: theme.text.feedback.error.base,
    warning: theme.text.feedback.warning.base,
    border: theme.border.base,
    background: theme.background.base,
    selectedBackground: theme.background.raised.base,
  };
}

export function colorFor(theme: OpenTuiThemeTokens | ThemeTokens | undefined, token: StyleToken = "text"): OpenTuiColor {
  return (theme as OpenTuiThemeTokens | undefined)?.[token] ?? defaultThemeTokens[token];
}
