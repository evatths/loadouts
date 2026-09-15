import { describe, expect, it } from "vitest";
import type { InstructionEntryInfo, JsonValue, SessionInfo } from "@opencode/client";
import { compileRuntimeBundle } from "../../core/runtime.js";
import { entryKey, type SessionCompilation } from "./delta.js";
import { ENTRY_LIMIT, MANIFEST_KEY, SessionActivator, type SessionClient } from "./session.js";

function fixture() {
  const sessions = new Map<string, SessionInfo>();
  const entries = new Map<string, Map<string, JsonValue>>();
  let fail: string | undefined;
  let writes = 0;
  for (const id of ["ses_a", "ses_b"]) {
    sessions.set(id, { id, projectID: "project", location: { directory: `/work/${id}` }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, updated: 0 },
      permissions: [{ action: "shell", resource: "git push *", effect: "ask" }] });
    entries.set(id, new Map([["unrelated", "keep me"]]));
  }
  const client: SessionClient = {
    plugin: { awaitActivation: async () => {} },
    session: {
      switchAgent: async ({ sessionID, agent }) => { sessions.get(sessionID)!.agent = agent; },
      switchModel: async ({ sessionID, model }) => { sessions.get(sessionID)!.model = model; },
      get: async ({ sessionID }) => structuredClone(sessions.get(sessionID)!),
      instructions: { entry: {
        list: async ({ sessionID }) => Array.from(entries.get(sessionID)!, ([key, value]): InstructionEntryInfo => ({ key, value: structuredClone(value) })),
        put: async ({ sessionID, key, value }) => {
          writes++;
          if (fail === key) { fail = undefined; throw new Error("Injected write failure"); }
          entries.get(sessionID)!.set(key, structuredClone(value));
        },
        remove: async ({ sessionID, key }) => { writes++; entries.get(sessionID)!.delete(key); },
      } },
    },
    permission: { rules: async ({ sessionID, permissions }) => { writes++; sessions.get(sessionID)!.permissions = structuredClone([...permissions]); } },
    skill: { list: async () => ({ location: { directory: "/work", project: { id: "project", directory: "/work", canonical: "/work" } },
      data: ["alpha", "beta"].map((id) => ({ id, name: id, content: "body", location: `/skills/${id}/SKILL.md` })) }) },
  };
  let source = "body";
  const directories: string[] = [];
  const compile = async (directory: string, names: string[]): Promise<SessionCompilation> => {
    directories.push(directory);
    return { bundle: compileRuntimeBundle("opencode", names.map((name) => ({ name, rootPath: directory, tools: ["opencode"], items: [] }))),
      entries: Object.fromEntries(names.map((name) => [entryKey(name), source + name])), skills: names, warnings: [] };
  };
  return { client, sessions, entries, directories, compile, equipment: new SessionActivator(client, compile),
    failNext(key: string) { fail = key; }, setSource(text: string) { source = text; }, writes: () => writes };
}

describe("SessionActivator", () => {
  it("isolates sessions, replaces stale keys, and restores prior permissions after reconnect", async () => {
    const f = fixture();
    await f.equipment.equip("ses_a", ["alpha"], { scope: "project" });
    await f.equipment.equip("ses_b", ["beta"], { scope: "global" });
    expect(f.directories).toEqual(["/work/ses_a", "/work/ses_b"]);
    expect(f.sessions.get("ses_a")!.permissions!.at(-1)).toEqual({ action: "skill", resource: "beta", effect: "deny" });
    expect(f.sessions.get("ses_b")!.permissions!.at(-1)).toEqual({ action: "skill", resource: "alpha", effect: "deny" });
    await f.equipment.equip("ses_a", ["beta"], { scope: "project" });
    expect(f.entries.get("ses_a")!.has(entryKey("alpha"))).toBe(false);
    expect(f.entries.get("ses_a")!.get("unrelated")).toBe("keep me");
    const fresh = new SessionActivator(f.client, f.compile);
    expect((await fresh.status("ses_a"))?.names).toEqual(["beta"]);
    await fresh.unequip("ses_a");
    expect([...f.entries.get("ses_a")!]).toEqual([["unrelated", "keep me"]]);
    expect(f.sessions.get("ses_a")!.permissions).toEqual([{ action: "shell", resource: "git push *", effect: "ask" }]);
    expect((await fresh.status("ses_b"))?.names).toEqual(["beta"]);
  });

  it("preserves externally edited rules on unequip and rejects overwriting them on re-equip", async () => {
    const f = fixture();
    await f.equipment.equip("ses_a", ["alpha"], { scope: "project" });
    const external = [{ action: "edit", resource: "*", effect: "deny" as const }];
    f.sessions.get("ses_a")!.permissions = external;
    await expect(f.equipment.equip("ses_a", ["beta"], { scope: "project" })).rejects.toThrow("permissions changed");
    expect((await f.equipment.unequip("ses_a")).warnings).toHaveLength(1);
    expect(f.sessions.get("ses_a")!.permissions).toEqual(external);
  });

  it("rolls back a failed multi-entry replacement", async () => {
    const f = fixture();
    await f.equipment.equip("ses_a", ["alpha"], { scope: "project" });
    const before = structuredClone([...f.entries.get("ses_a")!]);
    const permissions = structuredClone(f.sessions.get("ses_a")!.permissions);
    f.failNext(MANIFEST_KEY);
    await expect(f.equipment.equip("ses_a", ["beta"], { scope: "project" })).rejects.toThrow("Injected write failure");
    expect([...f.entries.get("ses_a")!].sort()).toEqual(before.sort());
    expect(f.sessions.get("ses_a")!.permissions).toEqual(permissions);
  });

  it("preflights serialized UTF-8 size and foreign keys before writes", async () => {
    const f = fixture();
    f.setSource("🐋".repeat(ENTRY_LIMIT / 4));
    await expect(f.equipment.equip("ses_a", ["alpha"], { scope: "project" })).rejects.toThrow("256 KiB");
    expect(f.writes()).toBe(0);
    f.setSource("small");
    f.entries.get("ses_a")!.set(entryKey("alpha"), "foreign");
    await expect(f.equipment.equip("ses_a", ["alpha"], { scope: "project" })).rejects.toThrow("another producer");
    expect(f.writes()).toBe(0);
  });

  it("serializes overlapping equips for one session without stacking old gates", async () => {
    const f = fixture();
    await Promise.all([f.equipment.equip("ses_a", ["alpha"], { scope: "project" }), f.equipment.equip("ses_a", ["beta"], { scope: "project" })]);
    expect((await f.equipment.status("ses_a"))?.names).toEqual(["beta"]);
    expect(f.sessions.get("ses_a")!.permissions).toHaveLength(2);
  });

  it("makes collision-resistant API-safe keys including the reserved name", () => {
    const keys = ["manifest", "Base", "base", "a/b", "a-b"].map(entryKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(keys).not.toContain(MANIFEST_KEY);
  });

  it("applies declared agent/model and restores explicit previous selections", async () => {
    const f = fixture();
    const before = { providerID: "test", id: "original" };
    f.sessions.get("ses_a")!.agent = "build";
    f.sessions.get("ses_a")!.model = before;
    const equipment = new SessionActivator(f.client, async (...args) => ({
      ...await f.compile(args[0], args[1]), selection: { agent: "reviewer", model: { providerID: "test", id: "review" } },
    }));
    await equipment.equip("ses_a", ["alpha"], { scope: "project" });
    expect(f.sessions.get("ses_a")!.agent).toBe("reviewer");
    expect(f.sessions.get("ses_a")!.model?.id).toBe("review");
    await equipment.unequip("ses_a");
    expect(f.sessions.get("ses_a")!.agent).toBe("build");
    expect(f.sessions.get("ses_a")!.model).toEqual(before);
  });
});
