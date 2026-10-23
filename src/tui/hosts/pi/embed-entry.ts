import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { DashboardController } from "../../core/controller.js";
import { intentFromPiTuiInput, isCtrlC } from "../../skins/pi-tui/input.js";
import { piHostThemeToPiTuiTheme } from "../../skins/pi-tui/pi-theme-adapter.js";
import { renderDashboard, renderOverlay } from "../../skins/pi-tui/render.js";
import { PiSessionActivator } from "./inject.js";
import { parseEquipCommand } from "../../../integrations/opencode/command.js";
import { registerBuiltins } from "../../../builtins/index.js";
import { createPluginAPI } from "../../../core/plugin.js";
import { registry } from "../../../core/registry.js";

const ENTRY = "loadouts.equipment";
const savedSchema = z.object({ names: z.array(z.string()), scope: z.enum(["project", "global"]) });

export default function loadoutsPiExtension(pi: ExtensionAPI): void {
  if (!registry.getTool("pi")) registerBuiltins(createPluginAPI(registry));
  let activator: PiSessionActivator;
  let restoring = false;
  pi.on("session_start", async (_event, ctx) => {
    activator = new PiSessionActivator(ctx.cwd, (status) => {
      if (!restoring) pi.appendEntry(ENTRY, status ? { names: status.names, scope: status.scope } : null);
      ctx.ui.setStatus("loadouts", status ? `EQUIPPED S ${status.names.join("·")}` : undefined);
    });
    const entry = [...ctx.sessionManager.getBranch()].reverse().find((item) => item.type === "custom" && item.customType === ENTRY);
    if (entry?.type !== "custom") return;
    const parsed = savedSchema.safeParse(entry.data);
    if (!parsed.success || !parsed.data.names.length) return;
    restoring = true;
    try { await activator.equip(ctx.sessionManager.getSessionId(), parsed.data.names, { scope: parsed.data.scope }); }
    catch (error) { ctx.ui.notify(String(error), "error"); }
    finally { restoring = false; }
  });

  pi.on("before_agent_start", (event, ctx) => {
    const block = activator?.systemBlock(ctx.sessionManager.getSessionId());
    return block ? { systemPrompt: `${event.systemPrompt}\n\n${block}` } : undefined;
  });

  pi.registerCommand("loadouts", {
    description: "Loadout dashboard; equip, unequip, status",
    handler: async (args, ctx) => {
      try {
        const command = parseEquipCommand(args);
        const sessionID = ctx.sessionManager.getSessionId();
        if (command.action === "dashboard") { await dashboard(ctx, activator); return; }
        if (command.action === "equip") await activator.equip(sessionID, command.names, { scope: command.scope });
        if (command.action === "unequip") await activator.unequip(sessionID);
        ctx.ui.notify((await activator.status(sessionID))?.names.join(" + ") || "No session loadouts", "info");
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });
}

async function dashboard(ctx: ExtensionCommandContext, activator: PiSessionActivator): Promise<void> {
  if (ctx.mode !== "tui") { ctx.ui.notify("The dashboard requires Pi TUI mode.", "warning"); return; }
  await ctx.ui.custom<void>((tui, theme, _keys, done) => {
    const colors = piHostThemeToPiTuiTheme(theme);
    const controller = new DashboardController({
      cwd: ctx.cwd, session: { id: ctx.sessionManager.getSessionId(), activator },
      changed: () => tui.requestRender(), exit: () => { controller.dispose(); done(undefined); },
      edit: async (file) => { ctx.ui.notify(`Edit ${file} in your editor.`, "info"); },
    });
    const component: Component = {
      render: (width) => {
        const spec = controller.spec;
        const height = Math.max(1, Math.floor(tui.terminal.rows * 0.86));
        return spec.overlay ? renderOverlay(spec.overlay, width, colors, height) : renderDashboard(spec, width, colors, height);
      },
      handleInput: (input) => {
        const intent = isCtrlC(input) ? { t: "quit" as const } : intentFromPiTuiInput(input, controller.spec);
        if (intent) void controller.dispatch(intent);
      },
      invalidate() {},
    };
    void controller.refresh();
    return component;
  }, { overlay: true, overlayOptions: { width: "94%", maxHeight: "86%", minWidth: 42, margin: 1 } });
}
