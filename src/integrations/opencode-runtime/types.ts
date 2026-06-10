import type { RuntimeBundle } from "../../core/runtime.js";

export type RuntimeScope = "local" | "global";

export type RuntimeCommandAction =
  | "status"
  | "activate"
  | "deactivate"
  | "list"
  | "info"
  | "show"
  | "system-block"
  | "help";

export interface ParsedRuntimeCommand {
  action: RuntimeCommandAction;
  names: string[];
  scope: RuntimeScope;
}

export interface RuntimeSessionState {
  activeNames: string[];
  bundle: RuntimeBundle;
  systemBlock: string;
  activatedAt: string;
}

export type RuntimeSessionStore = Map<string, RuntimeSessionState>;

export interface BridgeCompileResult {
  bundle: RuntimeBundle;
  systemBlock: string;
}

export interface RuntimeBridge {
  compile(names: string[], scope: RuntimeScope, cwd: string): Promise<BridgeCompileResult>;
  list(scope: RuntimeScope, cwd: string): Promise<string>;
  info(names: string[], scope: RuntimeScope, cwd: string): Promise<string>;
}

export interface HandleRuntimeCommandOptions {
  sessionID: string;
  argumentsText: string;
  cwd: string;
  bridge: RuntimeBridge;
  store: RuntimeSessionStore;
  now?: () => string;
}

export interface HandleRuntimeCommandResult {
  text: string;
  command: ParsedRuntimeCommand;
}
