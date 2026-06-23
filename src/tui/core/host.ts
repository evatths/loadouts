import type { DashboardData } from "./data.js";
import type { ThemeTokens } from "./theme.js";

export interface HostContext {
  theme(): ThemeTokens;
  requestRender(): void;
  exit(): void;
  openEditor(path: string): Promise<void>;
  data: DashboardData;
  runtime?: RuntimeInjector;
}

export interface RuntimeStatus {
  active: string[];
  scope: "local" | "global";
  updatedAt?: string;
}

export interface RuntimeInjector {
  activate(names: string[], scope: "local" | "global"): Promise<void>;
  deactivate(): Promise<void>;
  status(): RuntimeStatus;
}
