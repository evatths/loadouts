import { describe, expect, it } from "vitest";
import { handleRuntimeCommand, parseRuntimeCommand } from "./command.js";
import { createRuntimeSessionStore, getRuntimeSessionState } from "./state.js";
import type { RuntimeBridge } from "./types.js";
import type { RuntimeBundle } from "../../core/runtime.js";

function makeBundle(fingerprint: string): RuntimeBundle {
  return {
    schemaVersion: 1,
    tool: "opencode",
    loadouts: [{ name: "base", rootPath: "/tmp/.loadouts" }],
    fingerprint,
    generatedAt: "2026-01-01T00:00:00.000Z",
    components: [],
    injection: {
      instructions: [],
      rules: [],
      skills: [],
    },
    diagnostics: [],
    capabilities: {
      runtimeMode: "experimental-runtime",
      modelInjection: {
        instructions: true,
        rules: true,
      },
      skillPathDiscovery: true,
      nativeSkillHotSwap: false,
      supportedKinds: ["instruction", "rule", "skill"],
    },
  };
}

describe("parseRuntimeCommand", () => {
  it("maps empty input and aliases", () => {
    expect(parseRuntimeCommand("")).toEqual({ action: "status", names: [], scope: "local" });
    expect(parseRuntimeCommand("s")).toEqual({ action: "status", names: [], scope: "local" });
    expect(parseRuntimeCommand("ls -g")).toEqual({ action: "list", names: [], scope: "global" });
  });

  it("parses activate and info forms with default local scope", () => {
    expect(parseRuntimeCommand("activate base extra")).toEqual({
      action: "activate",
      names: ["base", "extra"],
      scope: "local",
    });
    expect(parseRuntimeCommand("i base")).toEqual({
      action: "info",
      names: ["base"],
      scope: "local",
    });
  });

  it("rejects invalid combinations", () => {
    expect(() => parseRuntimeCommand("activate")).toThrow("activate requires at least one");
    expect(() => parseRuntimeCommand("show -l")).toThrow("Scope flags are only supported");
    expect(() => parseRuntimeCommand("list --local --global")).toThrow(
      "Use either --local or --global, not both."
    );
  });
});

describe("handleRuntimeCommand", () => {
  it("activates and persists runtime session state", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile(names, scope) {
        expect(names).toEqual(["base"]);
        expect(scope).toBe("local");
        const bundle = makeBundle("sha256:1234567890abcdef");
        return { bundle, systemBlock: "[block]" };
      },
      async list() {
        return "base";
      },
      async info() {
        return "base info";
      },
    };

    const result = await handleRuntimeCommand({
      sessionID: "sess-1",
      argumentsText: "activate base",
      cwd: "/repo",
      bridge,
      store,
      now: () => "2026-02-01T00:00:00.000Z",
    });

    expect(result.text).toContain("runtime: activated (local) base");
    const state = getRuntimeSessionState(store, "sess-1");
    expect(state?.activeNames).toEqual(["base"]);
    expect(state?.systemBlock).toBe("[block]");
    expect(state?.activatedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("supports status, show, system-block, and deactivate", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        return { bundle: makeBundle("sha256:abcdeffedcba"), systemBlock: "full-system" };
      },
      async list() {
        return "";
      },
      async info() {
        return "";
      },
    };

    await handleRuntimeCommand({
      sessionID: "sess-2",
      argumentsText: "a base",
      cwd: "/repo",
      bridge,
      store,
    });

    const status = await handleRuntimeCommand({
      sessionID: "sess-2",
      argumentsText: "status",
      cwd: "/repo",
      bridge,
      store,
    });
    expect(status.text).toContain("runtime: active");

    const show = await handleRuntimeCommand({
      sessionID: "sess-2",
      argumentsText: "show",
      cwd: "/repo",
      bridge,
      store,
    });
    expect(show.text).toContain("fingerprint: sha256:abcdeffedcba");

    const block = await handleRuntimeCommand({
      sessionID: "sess-2",
      argumentsText: "system-block",
      cwd: "/repo",
      bridge,
      store,
    });
    expect(block.text).toBe("full-system");

    const deactivated = await handleRuntimeCommand({
      sessionID: "sess-2",
      argumentsText: "clear",
      cwd: "/repo",
      bridge,
      store,
    });
    expect(deactivated.text).toBe("runtime: deactivated");
  });
});
