import * as path from "node:path";
import { Plugin, Skill } from "@opencode/plugin";
import { AbsolutePath } from "@opencode/schema/schema";
import { registerBuiltins } from "../../../builtins/index.js";
import { createPluginAPI } from "../../../core/plugin.js";
import { registry } from "../../../core/registry.js";
import { getContext } from "../../../core/discovery.js";
import { parseMarkdownFrontmatter, parseRootConfig } from "../../../core/config.js";
import { isDirectory, readFile } from "../../../lib/fs.js";
import { loadDashboardData } from "../../core/data.js";
import { compileSession } from "../../../integrations/opencode/delta.js";
import { requireClient } from "../../../integrations/opencode/client.js";
import { SessionActivator } from "../../../integrations/opencode/session.js";
import { parseEquipCommand } from "../../../integrations/opencode/command.js";
import { filterSkillAdvertisement, skillDenied } from "../../../integrations/opencode/advertisement.js";
import { LoadoutsRPC } from "./rpc.js";

export default Plugin.define({
  id: "loadouts",
  async setup(ctx) {
    if (!registry.getTool("opencode")) registerBuiltins(createPluginAPI(registry));
    const directory = ctx.location.directory;
    const virtual = new Map<string, { name: string; description: string; location: string; content: string }>();
    const data = await loadDashboardData(directory);
    for (const row of data.rows) {
      if (row.status === "broken") continue;
      const compiled = await compileSession(directory, [row.name], { scope: row.scope, excludeOnDisk: false }).catch((error) => {
        console.warn(`Loadouts: could not index ${row.name}: ${String(error)}`);
        return undefined;
      });
      if (!compiled) continue;
      for (const ref of compiled.bundle.injection.skills) {
        if (virtual.has(ref.name)) continue;
        const location = isDirectory(ref.sourcePath) ? path.join(ref.sourcePath, "SKILL.md") : ref.sourcePath;
        const parsed = parseMarkdownFrontmatter(readFile(location));
        virtual.set(ref.name, { name: ref.name, description: ref.description ?? "", location, content: parsed.body });
      }
    }
    // Catalog entries are location-wide. Hide these by default; advertise selected
    // off-disk skills in the per-session context hook below.
    const added = new Set<string>();
    const skills = await ctx.skill.transform((editor) => {
      added.clear();
      for (const [name, skill] of virtual) {
        const id = Skill.ID.make(name);
        if (editor.get(id)) continue;
        editor.add({ ...skill, id, name: Skill.Name.make(skill.name), location: AbsolutePath.make(skill.location), autoinvoke: false, slash: false });
        added.add(name);
      }
    });
    const activator = async () => new SessionActivator((await requireClient()).client);
    const hook = await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      event.system = event.system.map((part) => part.type === "text"
        ? { ...part, text: filterSkillAdvertisement(part.text, (id) => !skillDenied(id, session.permissions ?? [])) } : part);
      if (!added.size) return;
      // Instruction-entry APIs are absent from Plugin.Context in 2.0.3. Only
      // this optional off-disk extension uses managed-service discovery.
      const status = await activator().then((equipment) => equipment.status(event.sessionID)).catch(() => undefined);
      const selected = status?.skills.filter((id) => added.has(id) && !skillDenied(id, session.permissions ?? [])) ?? [];
      if (!selected.length) return;
      const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      event.system.push({ type: "text", cache: { type: "ephemeral" }, text: "<available_skills>\n" + selected.map((id) => {
        const skill = virtual.get(id)!;
        return `<skill>\n<id>${escape(id)}</id>\n<name>${escape(skill.name)}</name>\n<description>${escape(skill.description)}</description>\n</skill>`;
      }).join("\n") + "\n</available_skills>" });
    });
    const rpc = await ctx.rpc.register(LoadoutsRPC, {
      status: async ({ sessionID }) => {
        const status = await (await activator()).status(sessionID);
        return { names: status?.names ?? [], fingerprint: status?.fingerprint };
      },
      equip: async ({ sessionID, names, scope }) => {
        const result = await (await activator()).equip(sessionID, names, { scope });
        await rpc.events.emit("changed", { sessionID });
        return { names: result.status.names, warnings: result.warnings };
      },
      unequip: async ({ sessionID }) => {
        const result = await (await activator()).unequip(sessionID);
        await rpc.events.emit("changed", { sessionID });
        return result;
      },
    });
    const command = await ctx.command.transform((editor) => {
      editor.add({ name: "loadouts", description: "Equip session loadouts", execute: async ({ sessionID, prompt }) => {
        const input = parseEquipCommand(prompt.text);
        const equipment = await activator();
        if (input.action === "equip") await equipment.equip(sessionID, input.names, { scope: input.scope });
        else if (input.action === "unequip") await equipment.unequip(sessionID);
        else if (input.action !== "status" && input.action !== "list") throw new Error("Use the TUI for the dashboard; headless: /loadouts equip <names> [-g|-p]");
      } });
    });
    const abort = new AbortController();
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
        if (event.type !== "session.created" || event.data.location.directory !== directory || event.data.parentID) continue;
        const root = await getContext("project", directory).catch(() => undefined);
        const defaults = root ? parseRootConfig(root.configPath).opencode?.defaultSession : undefined;
        if (defaults?.length) await (await activator()).equip(event.data.sessionID, defaults, { scope: "project" });
      }
    })().catch((error) => { if (!abort.signal.aborted) console.error("Loadouts auto-equip:", error); });
    return async () => {
      abort.abort();
      await Promise.all([hook.dispose(), skills.dispose(), command.dispose(), rpc.dispose()]);
    };
  },
});
