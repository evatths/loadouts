export type StyleToken =
  | "text"
  | "muted"
  | "dim"
  | "accent"
  | "success"
  | "error"
  | "warning"
  | "border";

export interface ThemeTokens {
  text: string;
  muted: string;
  dim: string;
  accent: string;
  success: string;
  error: string;
  warning: string;
  border: string;
  background?: string;
  selectedBackground?: string;
}

export const defaultThemeTokens: ThemeTokens = {
  text: "text",
  muted: "muted",
  dim: "dim",
  accent: "accent",
  success: "success",
  error: "error",
  warning: "warning",
  border: "border",
};
