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
  toastDuration?: number;
}

interface RuntimeUiEvent {
  id: string;
  sessionID: string;
  kind?: "toast" | "open";
  title: string;
  message: string;
  variant: "info" | "success" | "error";
  createdAt: string;
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
  variant: "info" | "success" | "error",
  duration: number
): Promise<void> {
  if (duration === 0) return;

  const showToast = client?.tui?.showToast;
  if (!showToast) return;

  try {
    await showToast({
      directory,
      title: "Loadouts",
      message,
      variant,
      duration,
    });
  } catch {
    // Toast delivery is best-effort; command consumption should not depend on TUI availability.
  }
}

const DEFAULT_TOAST_DURATION_MS = 5000;
const MAX_TOAST_DURATION_MS = 3_600_000;

function parseToastDuration(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(value, MAX_TOAST_DURATION_MS);
}

function parseToastDurationFromEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return parseToastDuration(Number(trimmed));
}

function resolveToastDuration(
  pluginOptions: RuntimePluginOptions,
  runtimeOptions?: Record<string, unknown>
): number {
  const fromRuntime = parseToastDuration(runtimeOptions?.toastDuration);
  if (fromRuntime !== undefined) return fromRuntime;

  const fromPlugin = parseToastDuration(pluginOptions.toastDuration);
  if (fromPlugin !== undefined) return fromPlugin;

  const fromEnv = parseToastDurationFromEnv(process.env.LOADOUTS_OPENCODE_TOAST_DURATION);
  if (fromEnv !== undefined) return fromEnv;

  return DEFAULT_TOAST_DURATION_MS;
}

function shortFingerprint(fingerprint: string): string {
  return fingerprint.replace(/^sha256:/, "").slice(0, 12);
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function runtimeActivationToast(state: RuntimeSessionState | undefined): string | undefined {
  if (!state) return undefined;
  const injected = state.bundle.injection;
  return [
    `Loaded ${state.activeNames.join(", ")}`,
    `Injected: ${pluralize(injected.instructions.length, "instruction")}, ${pluralize(injected.rules.length, "rule")}, ${pluralize(injected.skills.length, "skill")}`,
    `Fingerprint: ${shortFingerprint(state.bundle.fingerprint)}`,
  ].join("\n");
}

function runtimeToastVariant(action: string): "info" | "success" {
  return action === "activate" || action === "deactivate" ? "success" : "info";
}

function runtimeEventTitle(action: string, variant: "info" | "success" | "error"): string {
  if (variant === "error") return "Loadouts Error";
  if (action === "activate") return "Loadouts Activated";
  if (action === "deactivate") return "Loadouts Deactivated";
  if (action === "list") return "Loadouts List";
  if (action === "info") return "Loadouts Info";
  if (action === "help") return "Loadouts Help";
  return "Loadouts Runtime";
}

function runtimeStatePath(cwd: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheRoot, "loadouts", "opencode-runtime", `${key}.json`);
}

function runtimeEventPath(cwd: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheRoot, "loadouts", "opencode-runtime", `${key}.event.json`);
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

function readRuntimeUiEvents(cwd: string): Record<string, RuntimeUiEvent> {
  try {
    const file = runtimeEventPath(cwd);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, RuntimeUiEvent>;
  } catch {
    return {};
  }
}

function persistRuntimeUiEvent(
  cwd: string,
  sessionID: string,
  title: string,
  message: string,
  variant: "info" | "success" | "error",
  kind: RuntimeUiEvent["kind"] = "toast"
): void {
  try {
    const file = runtimeEventPath(cwd);
    const events = readRuntimeUiEvents(cwd);
    events[sessionID] = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionID,
      kind,
      title,
      message,
      variant,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(events, null, 2), "utf-8");
  } catch {
    // TUI event delivery is best-effort and should not affect runtime injection.
  }
}

export type OpenCodeRuntimePlugin = (
  input: OpenCodePluginInput,
  options?: Record<string, unknown>
) => Promise<OpenCodeRuntimeHooks>;

export function createOpenCodeRuntimePlugin(options: RuntimePluginOptions = {}): OpenCodeRuntimePlugin {
  const bridge = options.bridge ?? new CliRuntimeBridge();
  const store = options.store ?? createRuntimeSessionStore();

  return async ({ directory, worktree, client }, runtimeOptions) => {
    const toastDuration = resolveToastDuration(options, runtimeOptions);

    return {
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

      if (input.arguments.trim().length === 0) {
        output.parts = [];
        persistRuntimeUiEvent(cwd, input.sessionID, "Loadouts", "Opening dashboard", "info", "open");
        throw new LoadoutsRuntimeCommandHandledError("runtime: opening loadouts dashboard");
      }

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
        const state = getRuntimeSessionState(store, input.sessionID);
        const toastMessage =
          result.command.action === "activate" ? runtimeActivationToast(state) ?? result.text : result.text;
        const variant = runtimeToastVariant(result.command.action);
        persistRuntimeUiEvent(
          cwd,
          input.sessionID,
          runtimeEventTitle(result.command.action, variant),
          toastMessage,
          variant
        );
        await showRuntimeToast(client, cwd, toastMessage, variant, toastDuration);
        throw new LoadoutsRuntimeCommandHandledError(result.text);
      } catch (error) {
        if (error instanceof LoadoutsRuntimeCommandHandledError) throw error;

        const text = `runtime: error: ${error instanceof Error ? error.message : String(error)}`;
        output.parts = [];
        persistRuntimeUiEvent(cwd, input.sessionID, runtimeEventTitle("error", "error"), text, "error");
        await showRuntimeToast(client, cwd, text, "error", toastDuration);
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
    };
  };
}

export const opencodeRuntimePlugin = createOpenCodeRuntimePlugin();
export const LoadoutsRuntimePlugin = opencodeRuntimePlugin;
export default opencodeRuntimePlugin;
