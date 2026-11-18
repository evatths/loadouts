import * as path from "node:path";
import * as fs from "node:fs";
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
import { SessionActivator } from "../../../integrations/opencode/session.js";
import { parseEquipCommand } from "../../../integrations/opencode/command.js";
import { filterSkillAdvertisement, skillDenied } from "../../../integrations/opencode/advertisement.js";
import { filterNativeInstructions, type compilePrivate } from "../../../integrations/opencode/private.js";
import { findPrivateProject } from "../../../core/private-project.js";
import { LoadoutsRPC } from "./rpc.js";

export default Plugin.define({
  id: "loadouts",
  async setup(ctx) {
    if (!registry.getTool("opencode")) registerBuiltins(createPluginAPI(registry));
    const directory = ctx.location.directory;
    const virtual = new Map<string, { name: string; description: string; path: string; content: string }>();
    const privateProject = await findPrivateProject(directory);
    const data = privateProject ? { rows: [] } : await loadDashboardData(directory);
    for (const row of data.rows) {
      if (row.status === "broken") continue;
      const compiled = await compileSession(directory, [row.name], { scope: row.scope, excludeOnDisk: false }).catch((error) => {
        console.warn(`Loadouts: could not index ${row.name}: ${String(error)}`);
        return undefined;
      });
      if (!compiled) continue;
      for (const ref of compiled.bundle.injection.skills) {
        if (virtual.has(ref.name)) continue;
        const file = isDirectory(ref.sourcePath) ? path.join(ref.sourcePath, "SKILL.md") : ref.sourcePath;
        const parsed = parseMarkdownFrontmatter(readFile(file));
        virtual.set(ref.name, { name: ref.name, description: ref.description ?? "", path: file, content: parsed.body });
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
        editor.add({ ...skill, id, name: Skill.Name.make(skill.name), path: AbsolutePath.make(skill.path), autoinvoke: false });
        added.add(name);
      }
    });
    const equipment = new SessionActivator(ctx);
    const activator = async () => equipment;
    const privateTurns = new Map<string, ReturnType<typeof compilePrivate>>();
    const nativeCaches = new Map<string, Map<string, Map<string, string>>>();
    const promptHook = await ctx.session.hook("prompt", async (event) => {
      privateTurns.delete(event.sessionID);
      const session = await ctx.session.get({ sessionID: event.sessionID });
      if (session.location.directory !== directory || !await findPrivateProject(session.location.directory)) return;
      // Reload before inspecting native winners, then again after refreshing virtual bodies.
      await ctx.skill.reload();
      const compiled = await equipment.refreshPrivate(event.sessionID, [...added], async (next) => {
        for (const skill of next.virtual) {
          const existing = virtual.get(skill.id);
          if (existing && existing.path !== skill.path) throw new Error(`Skill ${skill.id} is already registered from ${existing.path}.`);
          virtual.set(skill.id, skill);
        }
        await ctx.skill.reload();
        return [...added];
      });
      if (compiled) privateTurns.set(event.sessionID, compiled);
    });
    const hook = await ctx.session.hook("context", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID });
      const turn = privateTurns.get(event.sessionID);
      if (turn) {
        const cache = nativeCaches.get(event.sessionID) ?? new Map<string, Map<string, string>>();
        nativeCaches.set(event.sessionID, cache);
        filterNativeInstructions(event.system, turn.suppress, cache);
        const sources = turn.suppress.map((file) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } });
        const candidates = event.messages.filter((m) => m.role === "system" && m.content.some((part) => part.type === "text" && sources.some((file) => part.text.includes(`Instructions from: ${file}\n`))));
        if (candidates.length) {
          const history = await ctx.session.context({ sessionID: event.sessionID });
          for (const message of candidates) {
            if (message.role !== "system" || message.content.length !== 1 || message.content[0].type !== "text") throw new Error("Ambiguous native instruction update");
            const part = message.content[0], text = part.text, prefix = "The instructions changed:\n";
            const matches = history.filter((m) => m.type === "system" && m.text === text && m.metadata?.notice === "instructions" && JSON.stringify(m.metadata.instructionSources) === '["core/instructions"]');
            const occurrences = candidates.filter((m) => m.role === "system" && m.content.length === 1 && m.content[0].type === "text" && m.content[0].text === text);
            if (matches.length !== 1 || occurrences.length !== 1 || !text.startsWith(prefix)) throw new Error("Ambiguous native instruction update");
            const body = text.slice(prefix.length), targets = sources.filter((file) => body.includes(`Instructions from: ${file}\n`));
            const native = { type: "text", text: body, metadata: { experimental: { instructions: [{ key: "core/instructions", text: body }] } } };
            filterNativeInstructions([native], targets, cache);
            Object.assign(part, { text: prefix + native.text });
          }
        }
      }
      event.system = event.system.map((part) => part.type === "text"
        ? { ...part, text: filterSkillAdvertisement(part.text, (id) => !skillDenied(id, session.permissions ?? [])) } : part);
      if (!added.size) return;
      const status = turn ? await equipment.status(event.sessionID) : await equipment.status(event.sessionID).catch(() => undefined);
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
        if (await findPrivateProject(directory)) continue;
        const root = await getContext("project", directory).catch(() => undefined);
        const defaults = root ? parseRootConfig(root.configPath).opencode?.defaultSession : undefined;
        if (defaults?.length) await (await activator()).equip(event.data.sessionID, defaults, { scope: "project" });
      }
    })().catch((error) => { if (!abort.signal.aborted) console.error("Loadouts auto-equip:", error); });
    return async () => {
      abort.abort();
      await Promise.all([promptHook.dispose(), hook.dispose(), skills.dispose(), command.dispose(), rpc.dispose()]);
    };
  },
});
