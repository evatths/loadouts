import { spawn } from "node:child_process";
import { ProcessTerminal, TUI, type OverlayHandle } from "@earendil-works/pi-tui";
import * as path from "node:path";
import { getContext } from "../../core/discovery.js";
import type { Scope } from "../../core/types.js";
import { executeEffect } from "../core/actions.js";
import { loadDashboardData } from "../core/data.js";
import type { Effect, Intent } from "../core/intent.js";
import { createInitialModel, type Model } from "../core/model.js";
import { defaultThemeTokens } from "../core/theme.js";
import { update } from "../core/update.js";
import { view } from "../core/view.js";
import type { HostContext } from "../core/host.js";
import { isCtrlC } from "../skins/pi-tui/input.js";
import { PiTuiDashboard, PiTuiOverlay } from "../skins/pi-tui/render.js";
import { defaultPiTuiTokens } from "../skins/pi-tui/theme.js";

export async function runStandaloneTui(cwd: string = process.cwd()): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  let exited = false;
  let overlayHandle: OverlayHandle | undefined;
  let overlayComponent: PiTuiOverlay | undefined;

  const host: HostContext = {
    theme: () => ({ ...defaultThemeTokens, ...defaultPiTuiTokens() }),
    requestRender: () => tui.requestRender(),
    exit: () => stop(),
    openEditor: async (filePath) => {
      tui.stop();
      await openEditor(filePath);
      tui.start();
      tui.requestRender(true);
    },
    data: await loadDashboardData(cwd),
  };

  let model: Model = createInitialModel(host.data, { mode: "filesystem", scope: "project" });
  const dashboard = new PiTuiDashboard({ spec: view(model), theme: host.theme(), onIntent: dispatch });

  tui.addChild(dashboard);
  tui.setFocus(dashboard);
  tui.addInputListener((data) => {
    if (isCtrlC(data)) {
      stop();
      return { consume: true };
    }
    return undefined;
  });

  renderNow();
  tui.start();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!exited) return;
      clearInterval(interval);
      resolve();
    }, 20);
  });

  function dispatch(intent: Intent): void {
    if (model.overlay && intent.t === "quit") intent = { t: "closeOverlay" };
    if (intent.t === "cycleMode") return;

    const result = update(model, intent);
    model = { ...result.model, mode: "filesystem" };
    if (model.quitRequested) {
      stop();
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
        fs: await actionContext(effect, model.scope, cwd),
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
      host.data = await loadDashboardData(cwd);
      const next = createInitialModel(host.data, { mode: "filesystem", scope: model.scope });
      model = { ...next, filter: model.filter, filtering: model.filtering, cursor: model.cursor, overlay: model.overlay, diffLines: model.diffLines };
    }

    const result = update(model, actionIntent);
    model = { ...result.model, mode: "filesystem" };
    renderNow();
  }

  function renderNow(): void {
    const spec = view(model);
    dashboard.setSpec(spec);
    if (spec.overlay) {
      if (overlayComponent) overlayComponent.setSpec(spec.overlay);
      else {
        overlayComponent = new PiTuiOverlay(spec.overlay, host.theme(), dispatch);
        overlayHandle = tui.showOverlay(overlayComponent, { width: "72%", maxHeight: "70%", minWidth: 36, margin: 2 });
      }
    } else if (overlayHandle) {
      overlayHandle.hide();
      overlayHandle = undefined;
      overlayComponent = undefined;
      tui.setFocus(dashboard);
    }
    host.requestRender();
  }

  function stop(): void {
    if (exited) return;
    exited = true;
    tui.stop();
  }
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

async function openEditor(filePath: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [filePath], { stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code && code !== 0) reject(new Error(`${editor} exited with code ${code}`));
      else resolve();
    });
  });
}
