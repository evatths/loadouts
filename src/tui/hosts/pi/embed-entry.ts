import * as path from "node:path";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getContext } from "../../../core/discovery.js";
import type { Scope } from "../../../core/types.js";
import { CliRuntimeBridge } from "../../../integrations/opencode-runtime/bridge.js";
import { handleRuntimeCommand } from "../../../integrations/opencode-runtime/command.js";
import { createRuntimeSessionStore, getRuntimeSessionState } from "../../../integrations/opencode-runtime/state.js";
import { executeEffect } from "../../core/actions.js";
import { loadDashboardData, type DashboardData } from "../../core/data.js";
import type { Effect, Intent } from "../../core/intent.js";
import { createInitialModel, type Model } from "../../core/model.js";
import { defaultThemeTokens } from "../../core/theme.js";
import { update } from "../../core/update.js";
import { view } from "../../core/view.js";
import type { HostContext, RuntimeStatus } from "../../core/host.js";
import { isCtrlC, intentFromPiTuiInput } from "../../skins/pi-tui/input.js";
import { piHostThemeToPiTuiTheme } from "../../skins/pi-tui/pi-theme-adapter.js";
import { renderDashboard, renderOverlay } from "../../skins/pi-tui/render.js";
import type { PiTuiTheme } from "../../skins/pi-tui/theme.js";
import { PI_RUNTIME_SESSION_ID, PiRuntimeInjector, piRuntimeResourcePaths, piRuntimeSystemBlock, type PiRuntimeScopeState } from "./inject.js";

const STATUS_KEY = "loadouts";

export default function loadoutsPiExtension(pi: ExtensionAPI): void {
  const store = createRuntimeSessionStore();
  const scopeState: PiRuntimeScopeState = { scope: "local" };
  const bridge = new CliRuntimeBridge({ tool: "pi" });

  pi.on("before_agent_start", async (event) => {
    const block = piRuntimeSystemBlock(store);
    if (!block) return undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  pi.on("resources_discover", async () => piRuntimeResourcePaths(store));

  pi.registerCommand("loadouts", {
    description: "Open the loadouts dashboard or manage runtime loadouts",
    handler: async (args, ctx) => {
      if (args.trim().length === 0) {
        await openDashboard(ctx, store, scopeState);
        return;
      }

      try {
        const result = await handleRuntimeCommand({
          argumentsText: args,
          cwd: ctx.cwd,
          bridge,
          store,
          sessionID: PI_RUNTIME_SESSION_ID,
        });
        if (result.command.action === "activate") scopeState.scope = result.command.scope;
        updateStatus(ctx, statusFromStore(store, scopeState.scope));
        ctx.ui.notify(result.text, "info");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}

async function openDashboard(ctx: ExtensionCommandContext, store: ReturnType<typeof createRuntimeSessionStore>, scopeState: PiRuntimeScopeState): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/loadouts dashboard is only available in Pi TUI mode.", "warning");
    return;
  }

  let overlayHandle: OverlayHandle | undefined;

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const piTheme = piHostThemeToPiTuiTheme(theme);
    const injector = new PiRuntimeInjector({
      cwd: ctx.cwd,
      store,
      scopeState,
      onChange: (status) => updateStatus(ctx, status),
    });
    const host: HostContext = {
      theme: () => defaultThemeTokens,
      requestRender: () => {
        tui.requestRender();
      },
      exit: () => done(undefined),
      openEditor: async (filePath) => {
        ctx.ui.notify(`Edit ${filePath} from a terminal editor; embedded Pi edit is not available yet.`, "warning");
      },
      data: { rows: [], active: [], tools: [], issues: [], warnings: [] },
      runtime: injector,
    };
    let model: Model;
    const component = new PiDashboardComponent(piTheme, dispatch);

    void initialize();
    return component;

    async function initialize(): Promise<void> {
      host.data = applyRuntimeStatus(await loadDashboardData(ctx.cwd), injector.status());
      model = createInitialModel(host.data, { mode: "runtime", scope: "project" });
      renderNow();
    }

    function dispatch(intent: Intent): void {
      if (!model) return;
      if (isQuitIntent(intent, model)) {
        done(undefined);
        return;
      }

      const result = update(model, intent);
      model = result.model;
      if (model.quitRequested) {
        done(undefined);
        return;
      }
      renderNow();
      if (result.effect) void runEffect(result.effect);
    }

    async function runEffect(effect: Effect): Promise<void> {
      let actionIntent: Intent;
      try {
        if (effect.t === "editFile") await host.openEditor(effect.path);
        actionIntent = await executeEffect(effect, {
          fs: await actionContext(effect, model.scope, ctx.cwd),
          runtime: host.runtime,
        });
      } catch (err) {
        actionIntent = {
          t: "effectDone",
          effect: effect.t,
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (effect.t === "reload" || effect.t === "editFile") {
        host.data = applyRuntimeStatus(await loadDashboardData(ctx.cwd), injector.status());
        const next = createInitialModel(host.data, { mode: "runtime", scope: model.scope });
        model = { ...next, filter: model.filter, filtering: model.filtering, cursor: model.cursor, overlay: model.overlay, diffLines: model.diffLines };
      }

      const result = update(model, actionIntent);
      model = result.model;
      renderNow();
    }

    function renderNow(): void {
      component.setSpec(view(model));
      updateStatus(ctx, injector.status());
      host.requestRender();
    }
  }, {
    overlay: true,
    overlayOptions: { width: "94%", maxHeight: "86%", minWidth: 42, margin: 1 },
    onHandle: (handle) => {
      overlayHandle = handle;
    },
  });
}

class PiDashboardComponent implements Component {
  private spec = view(createInitialModel({ rows: [], active: [], tools: [], issues: [], warnings: [] }, { mode: "runtime" }));
  private readonly theme: PiTuiTheme;
  private readonly onIntent: (intent: Intent) => void;

  constructor(theme: PiTuiTheme, onIntent: (intent: Intent) => void) {
    this.theme = theme;
    this.onIntent = onIntent;
  }

  setSpec(spec: ReturnType<typeof view>): void {
    this.spec = spec;
  }

  render(width: number): string[] {
    return this.spec.overlay
      ? renderOverlay(this.spec.overlay, width, this.theme)
      : renderDashboard(this.spec, width, this.theme);
  }

  handleInput(data: string): void {
    if (isCtrlC(data)) {
      this.onIntent({ t: "quit" });
      return;
    }
    const intent = intentFromPiTuiInput(data, this.spec);
    if (intent) this.onIntent(intent);
  }

  invalidate(): void {}
}

function isQuitIntent(intent: Intent, model: Model): boolean {
  return intent.t === "quit" && !model.overlay && !model.filtering;
}

async function actionContext(effect: Effect, fallbackScope: Scope, cwd: string) {
  if (effect.t === "reload" || effect.t === "editFile") {
    return {
      scope: fallbackScope,
      configPath: cwd,
      statePath: path.join(cwd, ".state.json"),
      projectRoot: cwd,
    };
  }
  const scope = "scope" in effect ? effect.scope : fallbackScope;
  return getContext(scope, cwd);
}

function applyRuntimeStatus(data: DashboardData, status: RuntimeStatus): DashboardData {
  if (status.active.length === 0) return data;
  const scope = status.scope === "global" ? "global" : "project";
  const active = new Set(status.active);
  return {
    ...data,
    rows: data.rows.map((row) => active.has(row.name) && row.scope === scope
      ? { ...row, status: "active", activation: "runtime" }
      : row),
    active: Array.from(new Set([...data.active, ...status.active])).sort(),
  };
}

function statusFromStore(store: ReturnType<typeof createRuntimeSessionStore>, scope: RuntimeStatus["scope"]): RuntimeStatus {
  const state = getRuntimeSessionState(store, PI_RUNTIME_SESSION_ID);
  return {
    active: state?.activeNames ?? [],
    scope,
    updatedAt: state?.activatedAt,
  };
}

function updateStatus(ctx: Pick<ExtensionContext, "ui">, status: RuntimeStatus): void {
  if (status.active.length === 0) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(STATUS_KEY, undefined);
    return;
  }
  const names = status.active.join(" + ");
  ctx.ui.setStatus(STATUS_KEY, `EQUIPPED ${names}`);
  ctx.ui.setWidget(STATUS_KEY, [`EQUIPPED: ${names}`, `mode: runtime (${status.scope})`], { placement: "belowEditor" });
}
