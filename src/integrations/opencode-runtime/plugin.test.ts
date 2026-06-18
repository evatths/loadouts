import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LoadoutsRuntimeCommandHandledError, createOpenCodeRuntimePlugin } from "./plugin.js";
import { createRuntimeSessionStore } from "./state.js";
import type { RuntimeBridge } from "./types.js";
import type { RuntimeBundle } from "../../core/runtime.js";

function makeBundle(): RuntimeBundle {
  return {
    schemaVersion: 1,
    tool: "opencode",
    loadouts: [{ name: "base", rootPath: "/repo/.loadouts" }],
    fingerprint: "sha256:abcdef1234567890",
    generatedAt: "2026-01-01T00:00:00.000Z",
    components: [],
    injection: { instructions: [], rules: [], skills: [] },
    diagnostics: [],
    capabilities: {
      runtimeMode: "experimental-runtime",
      modelInjection: { instructions: true, rules: true },
      skillPathDiscovery: true,
      nativeSkillHotSwap: false,
      supportedKinds: ["instruction", "rule", "skill"],
    },
  };
}

function runtimeEventPath(cacheHome: string, cwd: string): string {
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheHome, "loadouts", "opencode-runtime", `${key}.event.json`);
}

describe("OpenCode runtime plugin adapter", () => {
  it("registers /loadouts with an empty template from the plugin config hook", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        throw new Error("should not compile");
      },
      async list() {
        return "";
      },
      async info() {
        return "";
      },
    };

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })({
      directory: "/repo",
      worktree: "/repo",
    });
    const config = {} as { command?: Record<string, { description?: string; template: string }> };

    await hooks.config(config);

    expect(config.command?.loadouts).toEqual({
      description: "Manage session-local Loadouts runtime activation",
      template: "",
    });
  });

  it("handles /loadouts command state and injects system block by session", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile(names, scope, cwd) {
        expect(names).toEqual(["base"]);
        expect(scope).toBe("global");
        expect(cwd).toBe("/repo");
        return { bundle: makeBundle(), systemBlock: "[runtime-system-block]" };
      },
      async list() {
        return "base";
      },
      async info() {
        return "base info";
      },
    };

    const toasts: Array<{ message: string; variant: string; duration?: number }> = [];
    const plugin = createOpenCodeRuntimePlugin({ bridge, store });
    const hooks = await plugin({
      directory: "/repo",
      worktree: "/repo",
      client: {
        tui: {
          showToast(input) {
            toasts.push({ message: input.message, variant: input.variant, duration: input.duration });
          },
        },
      },
    });
    const commandOutput = { parts: [] as Array<{ type: "text"; text: string }> };

    await expect(
      hooks["command.execute.before"](
        { command: "loadouts", sessionID: "ses_1", arguments: "a -g base" },
        commandOutput
      )
    ).rejects.toThrow(LoadoutsRuntimeCommandHandledError);

    expect(commandOutput.parts).toEqual([]);
    expect(toasts).toEqual([
      {
        message: "Loaded base\nInjected: 0 instructions, 0 rules, 0 skills\nFingerprint: abcdef123456",
        variant: "success",
        duration: 5000,
      },
    ]);

    const systemOutput = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]({ sessionID: "ses_1" }, systemOutput);

    expect(systemOutput.system).toEqual(["[runtime-system-block]"]);
  });

  it("persists runtime state across plugin instances for opencode run", async () => {
    const previousCacheHome = process.env.XDG_CACHE_HOME;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-runtime-plugin-"));
    process.env.XDG_CACHE_HOME = path.join(tempDir, "cache");

    try {
      const bridge: RuntimeBridge = {
        async compile() {
          return { bundle: makeBundle(), systemBlock: "[persisted-system-block]" };
        },
        async list() {
          return "base";
        },
        async info() {
          return "base info";
        },
      };

      const first = await createOpenCodeRuntimePlugin({ bridge, store: createRuntimeSessionStore() })({
        directory: tempDir,
        worktree: tempDir,
      });
      await expect(
        first["command.execute.before"](
          { command: "loadouts", sessionID: "ses_persist", arguments: "a base" },
          { parts: [] }
        )
      ).rejects.toThrow(LoadoutsRuntimeCommandHandledError);

      const events = JSON.parse(
        fs.readFileSync(runtimeEventPath(process.env.XDG_CACHE_HOME!, tempDir), "utf-8")
      ) as Record<string, { title: string; message: string; variant: string }>;
      expect(events.ses_persist).toMatchObject({
        title: "Loadouts Activated",
        message: "Loaded base\nInjected: 0 instructions, 0 rules, 0 skills\nFingerprint: abcdef123456",
        variant: "success",
      });

      const second = await createOpenCodeRuntimePlugin({ bridge, store: createRuntimeSessionStore() })({
        directory: tempDir,
        worktree: tempDir,
      });
      const output = { system: [] as string[] };

      await second["experimental.chat.system.transform"]({ sessionID: "ses_persist" }, output);

      expect(output.system).toEqual(["[persisted-system-block]"]);
    } finally {
      if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousCacheHome;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores non-loadouts commands", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        throw new Error("should not compile");
      },
      async list() {
        return "";
      },
      async info() {
        return "";
      },
    };

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })({
      directory: "/repo",
      worktree: "/repo",
    });
    const output = { parts: [] as Array<{ type: "text"; text: string }> };

    await hooks["command.execute.before"](
      { command: "other", sessionID: "ses_1", arguments: "a base" },
      output
    );

    expect(output.parts).toEqual([]);
  });

  it("consumes loadouts command errors before they can reach the assistant", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        throw new Error("should not compile");
      },
      async list() {
        return "";
      },
      async info() {
        return "";
      },
    };
    const toasts: Array<{ message: string; variant: string; duration?: number }> = [];

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })({
      directory: "/repo",
      worktree: "/repo",
      client: {
        tui: {
          showToast(input) {
            toasts.push({ message: input.message, variant: input.variant, duration: input.duration });
          },
        },
      },
    });
    const output = { parts: [{ type: "text" as const, text: "existing" }] };

    await expect(
      hooks["command.execute.before"]({ command: "loadouts", sessionID: "ses_1", arguments: "wat" }, output)
    ).rejects.toThrow("runtime: error: Unknown runtime command: wat");

    expect(output.parts).toEqual([]);
    expect(toasts).toEqual([
      {
        message: "runtime: error: Unknown runtime command: wat",
        variant: "error",
        duration: 5000,
      },
    ]);
  });

  it("uses custom plugin toast duration option", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        return { bundle: makeBundle(), systemBlock: "[runtime-system-block]" };
      },
      async list() {
        return "base";
      },
      async info() {
        return "base info";
      },
    };
    const toasts: Array<{ duration?: number }> = [];

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })(
      {
        directory: "/repo",
        worktree: "/repo",
        client: {
          tui: {
            showToast(input) {
              toasts.push({ duration: input.duration });
            },
          },
        },
      },
      { toastDuration: 1234 }
    );

    await expect(
      hooks["command.execute.before"](
        { command: "loadouts", sessionID: "ses_duration", arguments: "a base" },
        { parts: [] }
      )
    ).rejects.toThrow(LoadoutsRuntimeCommandHandledError);

    expect(toasts).toEqual([{ duration: 1234 }]);
  });

  it("uses env var toast duration fallback", async () => {
    const previousValue = process.env.LOADOUTS_OPENCODE_TOAST_DURATION;
    process.env.LOADOUTS_OPENCODE_TOAST_DURATION = "777";

    try {
      const store = createRuntimeSessionStore();
      const bridge: RuntimeBridge = {
        async compile() {
          return { bundle: makeBundle(), systemBlock: "[runtime-system-block]" };
        },
        async list() {
          return "base";
        },
        async info() {
          return "base info";
        },
      };
      const toasts: Array<{ duration?: number }> = [];

      const hooks = await createOpenCodeRuntimePlugin({ bridge, store })({
        directory: "/repo",
        worktree: "/repo",
        client: {
          tui: {
            showToast(input) {
              toasts.push({ duration: input.duration });
            },
          },
        },
      });

      await expect(
        hooks["command.execute.before"](
          { command: "loadouts", sessionID: "ses_env", arguments: "a base" },
          { parts: [] }
        )
      ).rejects.toThrow(LoadoutsRuntimeCommandHandledError);

      expect(toasts).toEqual([{ duration: 777 }]);
    } finally {
      if (previousValue === undefined) delete process.env.LOADOUTS_OPENCODE_TOAST_DURATION;
      else process.env.LOADOUTS_OPENCODE_TOAST_DURATION = previousValue;
    }
  });

  it("disables toast when duration is zero", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        return { bundle: makeBundle(), systemBlock: "[runtime-system-block]" };
      },
      async list() {
        return "base";
      },
      async info() {
        return "base info";
      },
    };
    let calls = 0;

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })(
      {
        directory: "/repo",
        worktree: "/repo",
        client: {
          tui: {
            showToast() {
              calls += 1;
            },
          },
        },
      },
      { toastDuration: 0 }
    );

    await expect(
      hooks["command.execute.before"](
        { command: "loadouts", sessionID: "ses_disabled", arguments: "a base" },
        { parts: [] }
      )
    ).rejects.toThrow(LoadoutsRuntimeCommandHandledError);

    expect(calls).toBe(0);
  });

  it("uses configured duration for error toasts", async () => {
    const store = createRuntimeSessionStore();
    const bridge: RuntimeBridge = {
      async compile() {
        throw new Error("boom");
      },
      async list() {
        return "";
      },
      async info() {
        return "";
      },
    };
    const toasts: Array<{ variant: string; duration?: number }> = [];

    const hooks = await createOpenCodeRuntimePlugin({ bridge, store })(
      {
        directory: "/repo",
        worktree: "/repo",
        client: {
          tui: {
            showToast(input) {
              toasts.push({ variant: input.variant, duration: input.duration });
            },
          },
        },
      },
      { toastDuration: 999 }
    );

    await expect(
      hooks["command.execute.before"](
        { command: "loadouts", sessionID: "ses_error_duration", arguments: "a base" },
        { parts: [] }
      )
    ).rejects.toThrow("runtime: error: boom");

    expect(toasts).toEqual([{ variant: "error", duration: 999 }]);
  });
});
