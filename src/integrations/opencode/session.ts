import { z } from "zod";
import type { OpenCode, InstructionEntryInfo, JsonValue, PermissionRuleset } from "@opencode/client";
import { compileSession } from "./delta.js";
import type { OpenCodeSelection, Scope } from "../../core/types.js";

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
});

export type SessionStatus = z.infer<typeof manifestSchema>;
export interface EquipOptions { scope: Scope; excludeOnDisk?: boolean }
export interface EquipResult { status: SessionStatus; warnings: string[] }

type Client = ReturnType<typeof OpenCode.make>;
export interface SessionClient {
  session: Pick<Client["session"], "get" | "instructions" | "switchAgent" | "switchModel">;
  permission: Pick<Client["permission"], "rules">;
  skill: Pick<Client["skill"], "list">;
  plugin: Pick<Client["plugin"], "awaitActivation">;
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
      if (!names.length) throw new Error("Choose at least one loadout, or use unequip.");
      const session = await this.client.session.get({ sessionID });
      await this.client.plugin.awaitActivation({ location: session.location });
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

  unequip(sessionID: string): Promise<{ warnings: string[] }> {
    return serialized(sessionID, async () => {
      const entries = await this.client.session.instructions.entry.list({ sessionID });
      const previous = parseSessionStatus(entries);
      if (!previous) return { warnings: [] };
      const session = await this.client.session.get({ sessionID });
      const permissions = session.permissions ?? [];
      const owned = equal(permissions, previous.appliedPermissions);
      const selection = { agent: session.agent, model: session.model };
      await this.replace(sessionID, entries, previous, {}, owned ? previous.priorPermissions : permissions, permissions, restoreSelection(previous, selection), selection);
      return { warnings: owned ? [] : ["Session permissions were edited externally and have been preserved."] };
    });
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
      await this.client.permission.rules({ sessionID, permissions });
    } catch (cause) {
      const failures: unknown[] = [];
      for (const key of keys) {
        try {
          if (before.has(key)) await api.put({ sessionID, key, value: before.get(key)! });
          else await api.remove({ sessionID, key });
        } catch (error) { failures.push(error); }
      }
      try { await this.client.permission.rules({ sessionID, permissions: beforePermissions }); }
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
