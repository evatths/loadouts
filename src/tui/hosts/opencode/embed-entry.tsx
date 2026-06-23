/** @jsxImportSource @opentui/solid */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createSignal } from "solid-js";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { getContext } from "../../../core/discovery.js";
import { CliRuntimeBridge } from "../../../integrations/opencode-runtime/bridge.js";
import { createRuntimeSessionStore, getRuntimeSessionState, setRuntimeSessionState, clearRuntimeSessionState } from "../../../integrations/opencode-runtime/state.js";
import type { RuntimeScope, RuntimeSessionState } from "../../../integrations/opencode-runtime/types.js";
import { executeEffect } from "../../core/actions.js";
import { loadDashboardData, type DashboardData } from "../../core/data.js";
import type { Effect, Intent } from "../../core/intent.js";
import type { HostContext, RuntimeInjector, RuntimeStatus } from "../../core/host.js";
import { createInitialModel, type Model, type ScopeFilter } from "../../core/model.js";
import { update } from "../../core/update.js";
import { view } from "../../core/view.js";
import { keymap } from "../../core/keymap.js";
import { Dashboard } from "../../skins/opentui/Dashboard.js";
import { keyForIntentCommand, intentNameForKey } from "../../skins/opentui/input.js";
import { toOpenTuiTheme } from "../../skins/opentui/theme.js";

type RuntimeUiEvent = {
  id: string;
  sessionID: string;
  kind?: "toast" | "open";
  title: string;
  message: string;
  variant: "info" | "success" | "error";
  createdAt: string;
};

const ROUTE = "loadouts";
const bridge = new CliRuntimeBridge();
const store = createRuntimeSessionStore();

function readValue(value: unknown): unknown {
  if (typeof value !== "function") return value;
  try {
    return (value as () => unknown)();
  } catch {
    return undefined;
  }
}

function getPath(root: unknown, keys: string[]): unknown {
  let current = root;
  for (const key of keys) {
    current = readValue(current);
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return readValue(current);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const resolved = readValue(value);
    if (typeof resolved === "string" && resolved.trim().length > 0) return resolved;
  }
  return undefined;
}

function resolveCwd(api: TuiPluginApi): string {
  return path.resolve(
    firstString(
      api.state.path?.directory,
      api.state.path?.worktree,
      getPath(api.state, ["project", "root"]),
      getPath(api.state, ["workspace", "root"]),
      process.cwd()
    ) ?? process.cwd()
  );
}

function resolveSessionID(api: TuiPluginApi, params?: Record<string, unknown>): string {
  return firstString(
    params?.sessionID,
    params?.sessionId,
    api.route.current.name === "session" ? api.route.current.params.sessionID : undefined,
    getPath(api.state, ["sessionID"]),
    getPath(api.state, ["session", "current", "id"])
  ) ?? "default";
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

function loadPersistedRuntimeState(cwd: string, sessionID: string): void {
  if (getRuntimeSessionState(store, sessionID)) return;
  const state = readPersistedStates(cwd)[sessionID];
  if (state) setRuntimeSessionState(store, sessionID, state);
}

function persistRuntimeState(cwd: string, sessionID: string): void {
  try {
    const file = runtimeStatePath(cwd);
    const states = readPersistedStates(cwd);
    const state = getRuntimeSessionState(store, sessionID);
    if (state) states[sessionID] = state;
    else delete states[sessionID];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(states, null, 2), "utf-8");
  } catch {
    // Runtime injection still works once the server plugin sees in-process state.
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

function latestEvent(events: RuntimeUiEvent[]): RuntimeUiEvent | undefined {
  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}

function latestVisibleEvent(api: TuiPluginApi): RuntimeUiEvent | undefined {
  const events = Object.values(readRuntimeUiEvents(resolveCwd(api)));
  if (events.length === 0) return undefined;
  const sessionID = resolveSessionID(api);
  return events.find((event) => event.sessionID === sessionID) ?? latestEvent(events);
}

async function dataWithRuntime(cwd: string, sessionID: string): Promise<DashboardData> {
  loadPersistedRuntimeState(cwd, sessionID);
  const data = await loadDashboardData(cwd);
  const state = getRuntimeSessionState(store, sessionID);
  if (!state) return data;

  const runtimeScope = state.scope === "global" ? "global" : "project";
  const active = new Set(state.activeNames);
  return {
    ...data,
    rows: data.rows.map((row) => active.has(row.name) && row.scope === runtimeScope
      ? { ...row, status: "active", activation: "runtime", issue: undefined }
      : row),
    active: Array.from(new Set([...data.active, ...state.activeNames])),
  };
}

function createRuntimeInjector(cwd: string, sessionID: string): RuntimeInjector {
  return {
    async activate(names: string[], scope: RuntimeScope): Promise<void> {
      const compiled = await bridge.compile(names, scope, cwd);
      setRuntimeSessionState(store, sessionID, {
        activeNames: names,
        bundle: compiled.bundle,
        systemBlock: compiled.systemBlock,
        activatedAt: new Date().toISOString(),
        scope,
      });
      persistRuntimeState(cwd, sessionID);
    },
    async deactivate(): Promise<void> {
      clearRuntimeSessionState(store, sessionID);
      persistRuntimeState(cwd, sessionID);
    },
    status(): RuntimeStatus {
      loadPersistedRuntimeState(cwd, sessionID);
      const state = getRuntimeSessionState(store, sessionID);
      return {
        active: state?.activeNames ?? [],
        scope: state?.scope ?? "local",
        updatedAt: state?.activatedAt,
      };
    },
  };
}

function LoadoutsRoute(props: { api: TuiPluginApi; params?: Record<string, unknown> }) {
  const cwd = resolveCwd(props.api);
  const sessionID = resolveSessionID(props.api, props.params);
  let model: Model | undefined;
  let host: HostContext | undefined;
  const [spec, setSpec] = createSignal(view(createInitialModel({ rows: [], active: [], tools: [], issues: [], warnings: [] }, { mode: "runtime" })));

  void initialize();

  return <Dashboard spec={spec()} theme={toOpenTuiTheme(props.api.theme.current)} onIntent={dispatch} />;

  async function initialize(): Promise<void> {
    const data = await dataWithRuntime(cwd, sessionID);
    host = {
      theme: () => toOpenTuiTheme(props.api.theme.current) as never,
      requestRender: () => props.api.renderer.requestRender(),
      exit: () => props.api.route.navigate("session", { sessionID }),
      openEditor,
      data,
      runtime: createRuntimeInjector(cwd, sessionID),
    };
    model = createInitialModel(data, { mode: "runtime", scope: "project" });
    renderNow();
  }

  function dispatch(intent: Intent): void {
    if (!model || !host) return;
    if (model.overlay && intent.t === "quit") intent = { t: "closeOverlay" };

    const result = update(model, intent);
    model = result.model;
    if (model.quitRequested) {
      host.exit();
      return;
    }
    renderNow();
    if (result.effect) void runEffect(result.effect);
  }

  async function runEffect(effect: Effect): Promise<void> {
    if (!model || !host) return;
    let actionIntent: Intent;
    try {
      if (effect.t === "editFile") await host.openEditor(effect.path);
      actionIntent = await executeEffect(effect, {
        fs: await actionContext(effect, model.scope, cwd),
        runtime: host.runtime,
      });
    } catch (err) {
      actionIntent = { t: "effectDone", effect: effect.t, ok: false, message: err instanceof Error ? err.message : String(err) };
    }

    if (effect.t === "reload" || effect.t === "editFile" || effect.mode === "runtime") {
      host.data = await dataWithRuntime(cwd, sessionID);
      const next = createInitialModel(host.data, { mode: model.mode, scope: model.scope });
      model = { ...next, filter: model.filter, filtering: model.filtering, cursor: model.cursor, overlay: model.overlay, diffLines: model.diffLines };
    }

    const result = update(model, actionIntent);
    model = result.model;
    renderNow();
    const variant = actionIntent.t === "effectDone" && actionIntent.ok ? "success" : "error";
    if (actionIntent.t === "effectDone" && actionIntent.message) props.api.ui.toast({ title: "Loadouts", message: actionIntent.message, variant });
  }

  function renderNow(): void {
    if (!model || !host) return;
    setSpec(view(model));
    host.requestRender();
  }
}

async function actionContext(effect: Effect, fallbackScope: ScopeFilter, cwd: string) {
  if (effect.t === "reload" || effect.t === "editFile") {
    return {
      scope: fallbackScope,
      configPath: cwd,
      statePath: path.join(cwd, ".state.json"),
      projectRoot: cwd,
    };
  }
  return getContext("scope" in effect ? effect.scope : fallbackScope, cwd);
}

async function openEditor(filePath: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR;
  if (!editor) throw new Error("Set VISUAL or EDITOR to edit loadouts from the embedded dashboard.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [filePath], { stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => code && code !== 0 ? reject(new Error(`${editor} exited with code ${code}`)) : resolve());
  });
}

const tui: TuiPlugin = async (api) => {
  api.route.register([{ name: ROUTE, render: ({ params }) => <LoadoutsRoute api={api} params={params} /> }]);

  api.keymap.registerLayer({
    commands: [
      {
        name: "loadouts.open",
        title: "Open Loadouts dashboard",
        category: "Loadouts",
        namespace: "loadouts",
        slashName: "loadouts",
        run: () => api.route.navigate(ROUTE, { sessionID: resolveSessionID(api) }),
      },
      ...keymap.filter((binding) => binding.mode !== "filter").flatMap((binding) => binding.keys.map((key) => ({
        name: intentNameForKey(key),
        title: `Loadouts: ${binding.label}`,
        category: "Loadouts",
        namespace: "loadouts",
        run: () => {
          if (api.route.current.name !== ROUTE) return false;
          const intent = keyForIntentCommand(intentNameForKey(key));
          if (!intent) return false;
          // The focused route handles real keypresses so filter mode can see printable text.
          return true;
        },
      }))),
    ],
  });

  let seenEventID = latestVisibleEvent(api)?.id;
  const interval = setInterval(() => {
    const event = latestVisibleEvent(api);
    if (!event || event.id === seenEventID) return;
    seenEventID = event.id;
    if (event.kind === "open") api.route.navigate(ROUTE, { sessionID: event.sessionID });
    else api.ui.toast({ title: event.title, message: event.message, variant: event.variant });
  }, 250);
  api.lifecycle.onDispose(() => clearInterval(interval));

  api.slots.register({
    id: "loadouts-runtime-equipped",
    slots: {
      session_prompt_right: (_ctx, props: { session_id?: string }) => {
        const sessionID = props.session_id ?? resolveSessionID(api);
        loadPersistedRuntimeState(resolveCwd(api), sessionID);
        const state = getRuntimeSessionState(store, sessionID);
        if (!state) return null;
        return <text fg={api.theme.current.accent}>EQUIPPED: {state.activeNames.join(" + ")}</text>;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "loadouts-runtime-tui",
  tui,
};

export default plugin;
