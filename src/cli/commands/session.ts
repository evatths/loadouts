import { Command } from "commander";
import { requireClient, selectSession, sessionsAt } from "../../integrations/opencode/client.js";
import { SessionActivator } from "../../integrations/opencode/session.js";
import { requireScopeForName } from "../../core/scope.js";
import { heading, keyValue, log } from "../../lib/output.js";

interface Options { session?: string; global?: boolean; project?: boolean; json?: boolean }

export const sessionCommand = new Command("session").description("Equip loadouts on one running OpenCode session");

for (const action of ["status", "equip", "unequip", "list"] as const) {
  const command = new Command(action)
    .description({ status: "Show session equipment", equip: "Replace session equipment", unequip: "Restore the session's previous permissions and remove equipment", list: "List sessions at this location" }[action])
    .option("--json", "Output JSON");
  if (action !== "list") command.option("--session <id>", "Session ID (defaults to most recently updated at cwd)");
  if (action === "equip") command.argument("<names...>", "Loadout names").option("-g, --global", "Resolve global loadouts").option("-p, --project", "Resolve project loadouts");
  command.action(async (...args: unknown[]) => {
    const names = action === "equip" ? args[0] as string[] : [];
    const options = args[action === "equip" ? 1 : 0] as Options;
    try {
      if (options.global && options.project) throw new Error("Use either --global or --project.");
      const { client, warning } = await requireClient();
      if (warning && !options.json) log.warn(warning);
      if (action === "list") {
        const sessions = await sessionsAt(client, process.cwd());
        if (options.json) console.log(JSON.stringify(sessions, null, 2));
        else {
          heading("OpenCode sessions");
          for (const session of sessions) keyValue({ Session: session.id, Title: session.title ?? "—" });
          if (!sessions.length) log.dim("No sessions at this location");
        }
        return;
      }
      const session = await selectSession(client, process.cwd(), options.session);
      const activator = new SessionActivator(client);
      if (action === "status") {
        const status = await activator.status(session.id);
        if (options.json) console.log(JSON.stringify({ sessionID: session.id, status: status ?? null }, null, 2));
        else {
          heading("Session equipment");
          keyValue({ Session: session.id, Loadouts: status?.names.join(" + ") || "—", Fingerprint: status?.fingerprint ?? "—", Scope: status?.scope ?? "—" });
        }
        return;
      }
      const result = action === "unequip" ? await activator.unequip(session.id)
        : await activator.equip(session.id, names, {
          scope: options.global ? "global" : options.project ? "project" : await requireScopeForName(names[0], {}, session.location.directory),
        });
      if (options.json) console.log(JSON.stringify({ sessionID: session.id, ...result }, null, 2));
      else {
        log.success(`${action === "equip" ? `Equipped ${names.join(" + ")}` : "Unequipped loadouts"} on ${session.id}`);
        for (const message of result.warnings) log.warn(message);
      }
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });
  sessionCommand.addCommand(command);
}
