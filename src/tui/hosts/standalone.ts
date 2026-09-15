import { spawn } from "node:child_process";
import { ProcessTerminal, TUI, type OverlayHandle } from "@earendil-works/pi-tui";
import { discoverClient, sessionsAt } from "../../integrations/opencode/client.js";
import { SessionActivator } from "../../integrations/opencode/session.js";
import { DashboardController } from "../core/controller.js";
import type { Intent } from "../core/intent.js";
import { defaultThemeTokens } from "../core/theme.js";
import { isCtrlC } from "../skins/pi-tui/input.js";
import { PiTuiDashboard, PiTuiOverlay } from "../skins/pi-tui/render.js";
import { defaultPiTuiTokens } from "../skins/pi-tui/theme.js";

export async function runStandaloneTui(cwd = process.cwd()): Promise<void> {
  const tui = new TUI(new ProcessTerminal());
  const theme = { ...defaultThemeTokens, ...defaultPiTuiTokens() };
  const connection = await discoverClient().catch(() => undefined);
  const activator = connection ? new SessionActivator(connection.client) : undefined;
  let exited = false;
  let finish: () => void = () => {};
  let overlay: OverlayHandle | undefined;
  let picker: { sessions: Awaited<ReturnType<typeof sessionsAt>>; index: number } | undefined;
  const controller = new DashboardController({ cwd, changed: render, exit: stop, edit: async (file) => {
    tui.stop();
    try { await openEditor(file); } finally { tui.start(); }
  } });
  const dashboard = new PiTuiDashboard({ spec: controller.spec, theme, onIntent: dispatch });
  tui.addChild(dashboard);
  tui.setFocus(dashboard);
  tui.addInputListener((data) => { if (isCtrlC(data)) { stop(); return { consume: true }; } });
  await controller.refresh();
  if (connection?.warning) controller.model.lastResult = { text: connection.warning, variant: "info" };
  if (connection) controller.model.lastResult = { text: "S: choose an OpenCode session", variant: "info" };
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  render();
  tui.start();
  await completed;

  function dispatch(intent: Intent) {
    if (picker) {
      if (intent.t === "move") picker.index = Math.max(0, Math.min(picker.sessions.length - 1, picker.index + intent.delta));
      if (intent.t === "quit" || intent.t === "closeOverlay") picker = undefined;
      if (intent.t === "enter" && picker) {
        const selected = picker.sessions[picker.index];
        picker = undefined;
        if (selected && activator) void controller.selectSession({ id: selected.id, activator });
      }
      render();
      return;
    }
    if (intent.t === "selectSession") {
      if (!connection) {
        controller.model.lastResult = { text: "No running OpenCode service", variant: "info" };
        render();
        return;
      }
      void sessionsAt(connection.client, cwd).then((sessions) => { picker = { sessions, index: 0 }; render(); }).catch((error) => {
        controller.model.lastResult = { text: String(error), variant: "error" }; render();
      });
      return;
    }
    void controller.dispatch(intent);
  }

  function render() {
    if (exited) return;
    const spec = controller.spec;
    if (controller.session) spec.footer.equipped.push({ text: `  ${controller.session.id}`, style: "dim" });
    dashboard.setSpec(spec);
    overlay?.hide(); overlay = undefined;
    const selection = picker ? {
      kind: "help" as const, title: "Choose session · j/k, enter",
      lines: picker.sessions.length ? picker.sessions.map((session, index) => [{ text: `${index === picker!.index ? "▸" : " "} ${session.title ?? session.id} (${session.id})`, style: "text" as const }]) : [[{ text: "No sessions at this location", style: "dim" as const }]],
    } : spec.overlay;
    if (selection) overlay = tui.showOverlay(new PiTuiOverlay(selection, theme, dispatch), { width: "90%", maxHeight: "75%", margin: 1 });
    else tui.setFocus(dashboard);
    tui.requestRender();
  }

  function stop() {
    if (exited) return;
    exited = true; controller.dispose(); tui.stop(); finish();
  }
}

async function openEditor(file: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [file], { stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => code ? reject(new Error(`Editor exited with ${code}`)) : resolve());
  });
}
