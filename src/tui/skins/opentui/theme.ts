import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { defaultThemeTokens, type StyleToken, type ThemeTokens } from "../../core/theme.js";

export type OpenTuiColor = string | object;

export type OpenTuiThemeTokens = Record<StyleToken, OpenTuiColor> & {
  background?: OpenTuiColor;
  selectedBackground?: OpenTuiColor;
};

export function toOpenTuiTheme(theme?: TuiThemeCurrent): OpenTuiThemeTokens {
  if (!theme) return defaultThemeTokens;
  return {
    text: theme.text,
    muted: theme.textMuted,
    dim: theme.borderSubtle,
    accent: theme.accent,
    success: theme.success,
    error: theme.error,
    warning: theme.warning,
    border: theme.border,
    background: theme.backgroundPanel,
    selectedBackground: theme.backgroundElement,
  };
}

export function colorFor(theme: OpenTuiThemeTokens | ThemeTokens | undefined, token: StyleToken = "text"): OpenTuiColor {
  return (theme as OpenTuiThemeTokens | undefined)?.[token] ?? defaultThemeTokens[token];
}
