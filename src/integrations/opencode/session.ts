import { z } from "zod";
import { existsSync } from "node:fs";
import type { OpenCode, InstructionEntryInfo, JsonValue, PermissionRuleset, SessionInfo } from "@opencode/client";
import { compileSession, renderedSources } from "./delta.js";
import type { OpenCodeSelection, Scope } from "../../core/types.js";
import { findPrivateProject, readPrivateSelection, teamLayerId, type PrivateProject } from "../../core/private-project.js";
import { compilePrivate } from "./private.js";

export const MANIFEST_KEY = "loadouts.manifest";
export const ENTRY_LIMIT = 256 * 1024;

const ruleSchema = z.object({ action: z.string(), resource: z.string(), effect: z.enum(["allow", "ask", "deny"]) });
const selectionSchema = z.object({ agent: z.string().optional(), model: z.object({ providerID: z.string(), id: z.string(), variant: z.string().optional() }).optional() });
const manifestSchema = z.object({
  version: z.literal(1),
  names: z.array(z.string()),
  scope: z.enum(["global", "project"]),
  fingerprint: z.string(),
  equippedAt: z.string(),
  keys: z.array(z.string().startsWith("loadouts.bundle.")),
  skills: z.array(z.string()),
  priorPermissions: z.array(ruleSchema),
  appliedPermissions: z.array(ruleSchema),
  priorSelection: selectionSchema.optional(),
  appliedSelection: selectionSchema.optional(),
  privateMode: z.enum(["follow", "explicit"]).optional(),
});

export type SessionStatus = z.infer<typeof manifestSchema>;
export interface EquipOptions { scope: Scope; excludeOnDisk?: boolean }
export interface EquipResult { status: SessionStatus; warnings: string[] }

type Client = ReturnType<typeof OpenCode.make>;
export interface SessionClient {
  session: Pick<Client["session"], "get" | "update" | "instructions" | "switchAgent" | "switchModel">;
  skill: Pick<Client["skill"], "list">;
  plugin: Pick<Client["plugin"], "list">;
}

export interface SessionEquipment {
  equip(sessionID: string, names: string[], options: EquipOptions): Promise<EquipResult>;
  unequip(sessionID: string): Promise<{ warnings: string[] }>;
  status(sessionID: string): Promise<SessionStatus | undefined>;
}

// Serialize callers in this process, including separate dashboard instances.
// V2 exposes no compare-and-swap across clients: see the documented concurrency limit.
const pending = new Map<string, Promise<unknown>>();
async function serialized<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(run);
  pending.set(id, next);
  try { return await next; } finally { if (pending.get(id) === next) pending.delete(id); }
}

export function parseSessionStatus(entries: InstructionEntryInfo[]): SessionStatus | undefined {
  const entry = entries.find((item) => item.key === MANIFEST_KEY);
  if (!entry) return undefined;
  const parsed = manifestSchema.safeParse(entry.value);
  if (!parsed.success) throw new Error("Unrecognized loadouts.manifest; cannot safely replace session equipment.");
  return parsed.data;
}

export class SessionActivator implements SessionEquipment {
  constructor(
    private readonly client: SessionClient,
    private readonly compile: typeof compileSession = compileSession,
  ) {}

  async status(sessionID: string): Promise<SessionStatus | undefined> {
    return parseSessionStatus(await this.client.session.instructions.entry.list({ sessionID }));
  }

  equip(sessionID: string, names: string[], options: EquipOptions): Promise<EquipResult> {
    return serialized(sessionID, async () => {
      const session = await this.client.session.get({ sessionID });
      const project = existsSync(session.location.directory) ? await findPrivateProject(session.location.directory) : null;
      if (project) {
        if (options.scope === "global" && names.some((name) => name.startsWith("team:"))) throw new Error("Team layers are not global loadouts.");
        const canonicalNames = options.scope === "global" ? names : names.map((name) => teamLayerId(project, name) ?? name);
        return this.privateUpdate(sessionID, session, project, canonicalNames, "explicit", options.scope);
      }
      if (!names.length) throw new Error("Choose at least one loadout, or use unequip.");
      await this.activated(session.location);
      const compiled = await this.compile(session.location.directory, [...new Set(names)], options);
      const catalog = await this.client.skill.list({ location: session.location });
      const entries = await this.client.session.instructions.entry.list({ sessionID });
      const previous = parseSessionStatus(entries);
      const currentPermissions = session.permissions ?? [];
      if (previous && !equal(currentPermissions, previous.appliedPermissions)) {
        throw new Error("Session permissions changed after equip. Unequip first to preserve those changes, then equip again.");
      }
      const priorPermissions = previous?.priorPermissions ?? currentPermissions;
      const currentSelection: OpenCodeSelection = { agent: session.agent, model: session.model };
      const priorSelection = previous?.priorSelection ?? currentSelection;
      const nextSelection = { ...restoreSelection(previous, currentSelection), ...compiled.selection };
      const selected = new Set(compiled.skills);
      // Deny only unselected skills: never grant an allow that overrides an agent's deny.
      const appliedPermissions: PermissionRuleset = [...priorPermissions, ...catalog.data
        .filter((skill) => !selected.has(skill.id))
        .map((skill) => ({ action: "skill", resource: skill.id, effect: "deny" as const }))];
      const status: SessionStatus = {
        version: 1, names: compiled.bundle.loadouts.map((loadout) => loadout.name), scope: options.scope,
        fingerprint: compiled.bundle.fingerprint, equippedAt: new Date().toISOString(),
        keys: Object.keys(compiled.entries), skills: compiled.skills, priorPermissions, appliedPermissions,
        priorSelection, appliedSelection: nextSelection,
      };
      const values: Record<string, JsonValue> = { ...compiled.entries, [MANIFEST_KEY]: status };
      for (const [key, value] of Object.entries(values)) checkEntrySize(key, value);
      for (const key of status.keys) {
        if (entries.some((entry) => entry.key === key) && !previous?.keys.includes(key)) {
          throw new Error(`Instruction entry ${key} is already owned by another producer.`);
        }
      }
      await this.replace(sessionID, entries, previous, values, appliedPermissions, currentPermissions, nextSelection, currentSelection);
      return { status, warnings: compiled.warnings };
    });
  }

  /** Refresh a following or explicitly equipped private session before its prompt. */
  refreshPrivate(sessionID: string, virtualOwned: string[] = [], prepare?: (compiled: ReturnType<typeof compilePrivate>) => Promise<string[]>): Promise<ReturnType<typeof compilePrivate> | undefined> {
    return serialized(sessionID, async () => {
      const session = await this.client.session.get({ sessionID });
      const project = existsSync(session.location.directory) ? await findPrivateProject(session.location.directory) : null;
      if (!project) return undefined;
      const entries = await this.client.session.instructions.entry.list({ sessionID });
      const previous = parseSessionStatus(entries);
      if (previous && !previous.privateMode) return undefined; // legacy explicit equipment
      const saved = previous?.privateMode === "explicit" ? previous.names : readPrivateSelection(project);
      // Location-wide virtual skills must not become callable in default-following sessions.
      const names = saved ?? (virtualOwned.length ? project.layers.map((layer) => layer.id) : undefined);
      if (names === undefined) {
        if (previous) {
          const permissions = session.permissions ?? [];
          const owned = previous.appliedPermissions.slice(previous.priorPermissions.length);
          if (owned.length && !equal(permissions.slice(-owned.length), owned)) throw new Error("Session skill permissions changed after equip; unequip before updating.");
          const selection = { agent: session.agent, model: session.model };
          await this.replace(sessionID, entries, previous, {}, owned.length ? permissions.slice(0, -owned.length) : permissions, permissions, restoreSelection(previous, selection), selection);
        }
        return undefined;
      }
      return (await this.privateUpdate(sessionID, session, project, names, previous?.privateMode ?? "follow", previous?.scope ?? "project", virtualOwned, prepare)).compiled;
    });
  }

  private async privateUpdate(sessionID: string, session: SessionInfo, project: PrivateProject, names: string[], mode: "follow" | "explicit", scope: Scope, virtualOwned: string[] = [], prepare?: (compiled: ReturnType<typeof compilePrivate>) => Promise<string[]>): Promise<EquipResult & { compiled: ReturnType<typeof compilePrivate> }> {
    const entries = await this.client.session.instructions.entry.list({ sessionID });
    const previous = parseSessionStatus(entries);
    const current = session.permissions ?? [];
    let prior = current;
    if (previous) {
      const owned = previous.appliedPermissions.slice(previous.priorPermissions.length);
      if (owned.length && !equal(current.slice(-owned.length), owned)) throw new Error("Session skill permissions changed after equip; unequip before updating.");
      prior = owned.length ? current.slice(0, -owned.length) : current;
    }
    const rendered = await renderedSources(session.location.directory);
    let compiled = compilePrivate(project, [...new Set(names)], (await this.client.skill.list({ location: session.location })).data, rendered, virtualOwned, scope);
    if (prepare) {
      virtualOwned = await prepare(compiled);
      compiled = compilePrivate(project, [...new Set(names)], (await this.client.skill.list({ location: session.location })).data, rendered, virtualOwned, scope);
    }
    const selected = new Set(compiled.virtual.map((skill) => skill.id));
    const denied = [...new Set([...compiled.deny, ...virtualOwned.filter((id) => !selected.has(id))])];
    const applied: PermissionRuleset = [...prior, ...denied.map((resource) => ({ action: "skill", resource, effect: "deny" as const }))];
    const selection = { agent: session.agent, model: session.model };
    const status: SessionStatus = {
      version: 1, names: [...new Set(names)], scope, fingerprint: compiled.fingerprint,
      equippedAt: previous?.equippedAt ?? new Date().toISOString(), keys: Object.keys(compiled.entries),
      skills: compiled.virtual.map((skill) => skill.id), priorPermissions: prior, appliedPermissions: applied,
      priorSelection: previous?.priorSelection ?? selection, appliedSelection: selection, privateMode: mode,
    };
    const values: Record<string, JsonValue> = { ...compiled.entries, [MANIFEST_KEY]: status };
    for (const [key, value] of Object.entries(values)) checkEntrySize(key, value);
    for (const key of status.keys) if (entries.some((entry) => entry.key === key) && !previous?.keys.includes(key)) throw new Error(`Instruction entry ${key} is already owned by another producer.`);
    const sameValues = Object.entries(values).every(([key, value]) => JSON.stringify(entries.find((entry) => entry.key === key)?.value) === JSON.stringify(value))
      && (previous?.keys ?? []).every((key) => key in values);
    if (!sameValues || !equal(current, applied)) await this.replace(sessionID, entries, previous, values, applied, current, selection, selection);
    return { status, warnings: [], compiled };
  }

  unequip(sessionID: string): Promise<{ warnings: string[] }> {
    return serialized(sessionID, async () => {
      const entries = await this.client.session.instructions.entry.list({ sessionID });
      const previous = parseSessionStatus(entries);
      if (!previous) return { warnings: [] };
      const session = await this.client.session.get({ sessionID });
      const permissions = session.permissions ?? [];
      const suffix = previous.appliedPermissions.slice(previous.priorPermissions.length);
      const owned = previous.privateMode ? !suffix.length || equal(permissions.slice(-suffix.length), suffix) : equal(permissions, previous.appliedPermissions);
      const restored = previous.privateMode && owned ? (suffix.length ? permissions.slice(0, -suffix.length) : permissions) : previous.priorPermissions;
      const selection = { agent: session.agent, model: session.model };
      await this.replace(sessionID, entries, previous, {}, owned ? restored : permissions, permissions, restoreSelection(previous, selection), selection);
      return { warnings: owned ? [] : ["Session permissions were edited externally and have been preserved."] };
    });
  }

  // A freshly booted location answers with an empty plugin list (and a partial
  // skill catalog) until activation finishes; V2 has no explicit await for it.
  private async activated(location: SessionInfo["location"]): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await this.client.plugin.list({ location })).data.length) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`OpenCode plugins did not activate at ${location.directory}.`);
  }

  private async replace(
    sessionID: string, entries: InstructionEntryInfo[], previous: SessionStatus | undefined,
    values: Record<string, JsonValue>, permissions: PermissionRuleset, beforePermissions: PermissionRuleset,
    selection: OpenCodeSelection, beforeSelection: OpenCodeSelection,
  ): Promise<void> {
    const api = this.client.session.instructions.entry;
    const keys = new Set([...(previous?.keys ?? []), ...Object.keys(values), MANIFEST_KEY]);
    const before = new Map(entries.filter((entry) => keys.has(entry.key)).map((entry) => [entry.key, entry.value]));
    let agentChanged = false;
    let modelChanged = false;
    try {
      for (const [key, value] of Object.entries(values)) {
        if (key !== MANIFEST_KEY) await api.put({ sessionID, key, value });
      }
      for (const key of previous?.keys ?? []) {
        if (!(key in values)) await api.remove({ sessionID, key });
      }
      if (MANIFEST_KEY in values) await api.put({ sessionID, key: MANIFEST_KEY, value: values[MANIFEST_KEY] });
      else await api.remove({ sessionID, key: MANIFEST_KEY });
      if (selection.agent && selection.agent !== beforeSelection.agent) {
        await this.client.session.switchAgent({ sessionID, agent: selection.agent }); agentChanged = true;
      }
      if (selection.model && JSON.stringify(selection.model) !== JSON.stringify(beforeSelection.model)) {
        await this.client.session.switchModel({ sessionID, model: selection.model }); modelChanged = true;
      }
      // Publish permissions last. Its native event lets other clients refresh the
      // committed manifest even before the next model turn drains instruction updates.
      await this.client.session.update({ sessionID, permissions });
    } catch (cause) {
      const failures: unknown[] = [];
      for (const key of keys) {
        try {
          if (before.has(key)) await api.put({ sessionID, key, value: before.get(key)! });
          else await api.remove({ sessionID, key });
        } catch (error) { failures.push(error); }
      }
      try { await this.client.session.update({ sessionID, permissions: beforePermissions }); }
      catch (error) { failures.push(error); }
      if (agentChanged) {
        try {
          if (!beforeSelection.agent) throw new Error("Prior agent was implicit; V2 cannot clear an explicit selection.");
          await this.client.session.switchAgent({ sessionID, agent: beforeSelection.agent });
        } catch (error) { failures.push(error); }
      }
      if (modelChanged) {
        try {
          if (!beforeSelection.model) throw new Error("Prior model was implicit; V2 cannot clear an explicit selection.");
          await this.client.session.switchModel({ sessionID, model: beforeSelection.model });
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError([cause, ...failures], `Session ${sessionID} update failed and rollback was incomplete. Inspect its instruction entries and permissions before retrying.`);
      throw cause;
    }
  }
}

function restoreSelection(previous: SessionStatus | undefined, current: OpenCodeSelection): OpenCodeSelection {
  const next = { ...current };
  if (previous?.priorSelection?.agent && current.agent === previous.appliedSelection?.agent) next.agent = previous.priorSelection.agent;
  if (previous?.priorSelection?.model && JSON.stringify(current.model) === JSON.stringify(previous.appliedSelection?.model)) next.model = previous.priorSelection.model;
  return next;
}

function equal(a: PermissionRuleset, b: PermissionRuleset): boolean {
  return a.length === b.length && a.every((rule, i) => rule.action === b[i].action && rule.resource === b[i].resource && rule.effect === b[i].effect);
}

export function checkEntrySize(key: string, value: JsonValue): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > ENTRY_LIMIT) {
    throw new Error(`Instruction entry ${key} exceeds OpenCode's 256 KiB limit. Split the loadout into smaller bundles.`);
  }
}
