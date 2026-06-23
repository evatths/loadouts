import chalk from "chalk";
import { defaultThemeTokens, type StyleToken, type ThemeTokens } from "../../core/theme.js";

export type ColorFn = (text: string) => string;

export interface PiTuiTheme {
  color: Record<StyleToken, ColorFn>;
  selected: ColorFn;
  background: ColorFn;
}

const identity: ColorFn = (text) => text;

const DEFAULT_COLORS: Record<StyleToken, string> = {
  text: "#d7dae0",
  muted: "#8f98a8",
  dim: "#5f6878",
  accent: "#8bd5ff",
  success: "#9ece6a",
  error: "#ff6b7a",
  warning: "#e0af68",
  border: "#3b4261",
};

export function defaultPiTuiTokens(): ThemeTokens {
  return {
    ...defaultThemeTokens,
    ...DEFAULT_COLORS,
    background: "#11131a",
    selectedBackground: "#27324a",
  };
}

export function toPiTuiTheme(tokens: ThemeTokens = defaultPiTuiTokens()): PiTuiTheme {
  if (process.env.NO_COLOR) {
    return {
      color: {
        text: identity,
        muted: identity,
        dim: identity,
        accent: identity,
        success: identity,
        error: identity,
        warning: identity,
        border: identity,
      },
      selected: identity,
      background: identity,
    };
  }

  return {
    color: {
      text: colorFn(tokens.text, DEFAULT_COLORS.text),
      muted: colorFn(tokens.muted, DEFAULT_COLORS.muted),
      dim: colorFn(tokens.dim, DEFAULT_COLORS.dim),
      accent: colorFn(tokens.accent, DEFAULT_COLORS.accent),
      success: colorFn(tokens.success, DEFAULT_COLORS.success),
      error: colorFn(tokens.error, DEFAULT_COLORS.error),
      warning: colorFn(tokens.warning, DEFAULT_COLORS.warning),
      border: colorFn(tokens.border, DEFAULT_COLORS.border),
    },
    selected: tokens.selectedBackground ? chalk.bgHex(tokens.selectedBackground) : chalk.bgHex("#27324a"),
    background: tokens.background ? chalk.bgHex(tokens.background) : identity,
  };
}

function colorFn(value: string | undefined, fallback: string): ColorFn {
  const color = value && value.startsWith("#") ? value : fallback;
  return chalk.hex(color);
}
