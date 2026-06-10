import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliRuntimeBridge } from "./bridge.js";
import { handleRuntimeCommand } from "./command.js";
import {
  createRuntimeSessionStore,
  getRuntimeSessionState,
  renderInjectedSystemBlock,
  setRuntimeSessionState,
} from "./state.js";
import type { RuntimeBridge, RuntimeSessionState, RuntimeSessionStore } from "./types.js";

interface RuntimePluginOptions {
  bridge?: RuntimeBridge;
  store?: RuntimeSessionStore;
}

interface OpenCodePluginInput {
  directory: string;
  worktree: string;
  client?: OpenCodeClient;
}

interface OpenCodeConfigInput {
  command?: Record<string, { description?: string; template: string }>;
}

interface OpenCodeClient {
  tui?: {
    showToast?: (input: {
      directory?: string;
      title?: string;
      message: string;
      variant: "info" | "success" | "warning" | "error";
      duration?: number;
    }) => Promise<unknown> | unknown;
  };
}

interface CommandExecuteBeforeInput {
  command: string;
  sessionID: string;
  arguments: string;
}

interface CommandExecuteBeforeOutput {
  parts: Array<{ type: "text"; text: string }>;
}

interface SystemTransformInput {
  sessionID?: string;
}

interface SystemTransformOutput {
  system: string[];
}

interface OpenCodeRuntimeHooks {
  config: (input: OpenCodeConfigInput) => Promise<void>;
  "command.execute.before": (
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput
  ) => Promise<void>;
  "experimental.chat.system.transform": (
    input: SystemTransformInput,
    output: SystemTransformOutput
  ) => Promise<void>;
}

export class LoadoutsRuntimeCommandHandledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadoutsRuntimeCommandHandledError";
  }
}

async function showRuntimeToast(
  client: OpenCodeClient | undefined,
  directory: string,
  message: string,
  variant: "info" | "error"
): Promise<void> {
  const showToast = client?.tui?.showToast;
  if (!showToast) return;

  try {
    await showToast({
      directory,
      title: "Loadouts",
      message,
      variant,
      duration: 5000,
    });
  } catch {
    // Toast delivery is best-effort; command consumption should not depend on TUI availability.
  }
}

function runtimeStatePath(cwd: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheRoot, "loadouts", "opencode-runtime", `${key}.json`);
}

function readPersistedStates(cwd: string): Record<string, RuntimeSessionState> {
  try {
    const file = runtimeStatePath(cwd);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, RuntimeSessionState>;
  } catch {
    return {};
  }
}

function loadPersistedRuntimeState(cwd: string, store: RuntimeSessionStore, sessionID: string): void {
  if (getRuntimeSessionState(store, sessionID)) return;
  const state = readPersistedStates(cwd)[sessionID];
  if (state) setRuntimeSessionState(store, sessionID, state);
}

function persistRuntimeState(cwd: string, store: RuntimeSessionStore, sessionID: string): void {
  try {
    const file = runtimeStatePath(cwd);
    const states = readPersistedStates(cwd);
    const state = getRuntimeSessionState(store, sessionID);
    if (state) states[sessionID] = state;
    else delete states[sessionID];

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(states, null, 2), "utf-8");
  } catch {
    // The in-memory runtime still works inside a long-lived OpenCode process.
  }
}

export type OpenCodeRuntimePlugin = (
  input: OpenCodePluginInput,
  options?: Record<string, unknown>
) => Promise<OpenCodeRuntimeHooks>;

export function createOpenCodeRuntimePlugin(options: RuntimePluginOptions = {}): OpenCodeRuntimePlugin {
  const bridge = options.bridge ?? new CliRuntimeBridge();
  const store = options.store ?? createRuntimeSessionStore();

  return async ({ directory, worktree, client }) => ({
    config: async (config) => {
      config.command ??= {};
      config.command.loadouts = {
        description: "Manage session-local Loadouts runtime activation",
        template: "",
      };
    },

    "command.execute.before": async (input, output) => {
      if (input.command !== "loadouts") return;

      const cwd = directory || worktree || process.cwd();
      loadPersistedRuntimeState(cwd, store, input.sessionID);

      try {
        const result = await handleRuntimeCommand({
          sessionID: input.sessionID,
          argumentsText: input.arguments,
          cwd,
          bridge,
          store,
        });

        output.parts = [];
        persistRuntimeState(cwd, store, input.sessionID);
        await showRuntimeToast(client, cwd, result.text, "info");
        throw new LoadoutsRuntimeCommandHandledError(result.text);
      } catch (error) {
        if (error instanceof LoadoutsRuntimeCommandHandledError) throw error;

        const text = `runtime: error: ${error instanceof Error ? error.message : String(error)}`;
        output.parts = [];
        await showRuntimeToast(client, cwd, text, "error");
        throw new LoadoutsRuntimeCommandHandledError(text);
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID) return;

      const cwd = directory || worktree || process.cwd();
      loadPersistedRuntimeState(cwd, store, input.sessionID);
      const state = getRuntimeSessionState(store, input.sessionID);
      const block = renderInjectedSystemBlock(state);
      if (!block) return;

      output.system.push(block);
    },
  });
}

export const opencodeRuntimePlugin = createOpenCodeRuntimePlugin();
export const LoadoutsRuntimePlugin = opencodeRuntimePlugin;
export default opencodeRuntimePlugin;
