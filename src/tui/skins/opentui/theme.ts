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
    text: theme.text.default,
    muted: theme.text.subdued,
    dim: theme.text.subdued,
    accent: theme.text.action.primary.default,
    success: theme.text.feedback.success.default,
    error: theme.text.feedback.error.default,
    warning: theme.text.feedback.warning.default,
    border: theme.border.default,
    background: theme.background.default,
    selectedBackground: theme.background.surface.offset,
  };
}

export function colorFor(theme: OpenTuiThemeTokens | ThemeTokens | undefined, token: StyleToken = "text"): OpenTuiColor {
  return (theme as OpenTuiThemeTokens | undefined)?.[token] ?? defaultThemeTokens[token];
}
