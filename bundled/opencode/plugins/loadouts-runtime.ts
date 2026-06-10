import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

type RuntimeScope = "local" | "global";

type RuntimeBundle = {
  fingerprint: string;
  injection: {
    instructions: Array<{ relativePath: string; content: string }>;
    rules: Array<{ relativePath: string; content: string }>;
    skills: Array<{ name: string; description?: string; path: string; sourcePath: string }>;
  };
  capabilities: {
    runtimeMode: string;
    modelInjection: { instructions: boolean; rules: boolean };
    skillPathDiscovery: boolean;
    nativeSkillHotSwap: boolean;
  };
};

type RuntimeState = {
  activeNames: string[];
  bundle: RuntimeBundle;
  systemBlock: string;
  activatedAt: string;
};

type OpenCodeClient = {
  tui?: {
    showToast?: (input: {
      directory?: string;
      title?: string;
      message: string;
      variant: "info" | "success" | "warning" | "error";
      duration?: number;
    }) => Promise<unknown> | unknown;
  };
};

type OpenCodeConfigInput = {
  command?: Record<string, { description?: string; template: string }>;
};

class LoadoutsRuntimeCommandHandledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoadoutsRuntimeCommandHandledError";
  }
}

const sessions = new Map<string, RuntimeState>();

const aliases: Record<string, string> = {
  "": "status",
  status: "status",
  s: "status",
  activate: "activate",
  a: "activate",
  use: "activate",
  deactivate: "deactivate",
  d: "deactivate",
  remove: "deactivate",
  rm: "deactivate",
  clear: "deactivate",
  list: "list",
  ls: "list",
  info: "info",
  i: "info",
  show: "show",
  "system-block": "system-block",
  help: "help",
  "-h": "help",
  "--help": "help",
};

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function parseArgs(argumentsText: string): { action: string; names: string[]; scope: RuntimeScope } {
  const tokens = tokenize(argumentsText.trim());
  const action = aliases[(tokens.shift() ?? "").toLowerCase()];
  if (!action) throw new Error(`unknown /loadouts command: ${argumentsText || "(empty)"}`);

  let local = false;
  let global = false;
  const names: string[] = [];
  for (const token of tokens) {
    if (token === "-l" || token === "--local") {
      local = true;
      continue;
    }
    if (token === "-g" || token === "--global") {
      global = true;
      continue;
    }
    names.push(token);
  }

  if (local && global) throw new Error("use either --local or --global, not both");
  if ((local || global) && !["activate", "list", "info"].includes(action)) {
    throw new Error("scope flags are only supported for activate, list, and info");
  }
  if (action === "activate" && names.length === 0) {
    throw new Error("activate requires at least one loadout name");
  }

  return { action, names, scope: global ? "global" : "local" };
}

function scopeFlag(scope: RuntimeScope): string {
  return scope === "global" ? "--global" : "--local";
}

function shortFingerprint(fingerprint: string): string {
  return fingerprint.replace(/^sha256:/, "").slice(0, 12);
}

function execLoadouts(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("loadouts", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error((stderr || stdout || `loadouts exited with ${code}`).trim()));
    });
  });
}

function renderSystemBlock(bundle: RuntimeBundle): string {
  const lines: string[] = [];
  lines.push("[loadout-runtime:v1]");
  lines.push(`fingerprint: ${bundle.fingerprint}`);
  lines.push(
    `capabilities: mode=${bundle.capabilities.runtimeMode}, instructionInjection=${bundle.capabilities.modelInjection.instructions}, ruleInjection=${bundle.capabilities.modelInjection.rules}, skillPathDiscovery=${bundle.capabilities.skillPathDiscovery}, nativeSkillHotSwap=${bundle.capabilities.nativeSkillHotSwap}`
  );
  lines.push("");
  lines.push("## Instructions (Model Injection Ready)");
  for (const item of bundle.injection.instructions) {
    lines.push(`### ${item.relativePath}`);
    lines.push(item.content);
    lines.push("");
  }
  if (bundle.injection.instructions.length === 0) lines.push("(none)");
  lines.push("## Rules (Model Injection Ready)");
  for (const item of bundle.injection.rules) {
    lines.push(`### ${item.relativePath}`);
    lines.push(item.content);
    lines.push("");
  }
  if (bundle.injection.rules.length === 0) lines.push("(none)");
  lines.push("## Skills (Path Discovery Only)");
  lines.push("Native skill hot-swap is disabled in runtime v1.");
  for (const skill of bundle.injection.skills) {
    const description = skill.description ? ` - ${skill.description}` : "";
    lines.push(`- ${skill.name}${description}`);
    lines.push(`  path: ${skill.path}`);
    lines.push(`  sourcePath: ${skill.sourcePath}`);
  }
  if (bundle.injection.skills.length === 0) lines.push("(none)");
  return lines.join("\n").trimEnd() + "\n";
}

async function activate(names: string[], scope: RuntimeScope, sessionID: string, cwd: string): Promise<string> {
  const json = await execLoadouts(["runtime", ...names, "--tool", "opencode", "--json", scopeFlag(scope)], cwd);
  const bundle = JSON.parse(json) as RuntimeBundle;
  sessions.set(sessionID, {
    activeNames: names,
    bundle,
    systemBlock: renderSystemBlock(bundle),
    activatedAt: new Date().toISOString(),
  });
  return `runtime: activated (${scope}) ${names.join(", ")} [${shortFingerprint(bundle.fingerprint)}]`;
}

async function handle(argumentsText: string, sessionID: string, cwd: string): Promise<string> {
  const command = parseArgs(argumentsText);
  const state = sessions.get(sessionID);

  if (command.action === "help") {
    return "runtime commands: status, activate|a|use <names...> [-l|-g], deactivate|d|clear, list|ls [-l|-g], info [names...] [-l|-g], show, system-block";
  }
  if (command.action === "activate") return activate(command.names, command.scope, sessionID, cwd);
  if (command.action === "deactivate") {
    return sessions.delete(sessionID) ? "runtime: deactivated" : "runtime: already inactive";
  }
  if (command.action === "list") return (await execLoadouts(["list", scopeFlag(command.scope)], cwd)).trim();
  if (command.action === "info") return (await execLoadouts(["info", ...command.names, scopeFlag(command.scope)], cwd)).trim();
  if (command.action === "status") {
    return state
      ? `runtime: active ${state.activeNames.join(", ")} [${shortFingerprint(state.bundle.fingerprint)}]`
      : "runtime: inactive";
  }
  if (command.action === "show") {
    if (!state) return "runtime: inactive";
    const injected = state.bundle.injection;
    return [
      "runtime: active",
      `loadouts: ${state.activeNames.join(", ")}`,
      `fingerprint: ${state.bundle.fingerprint}`,
      `injected: instructions=${injected.instructions.length}, rules=${injected.rules.length}, skills=${injected.skills.length}`,
      `activatedAt: ${state.activatedAt}`,
    ].join("\n");
  }
  if (command.action === "system-block") return state?.systemBlock ?? "runtime: inactive";
  return "runtime: unsupported command";
}

async function showRuntimeToast(
  client: OpenCodeClient | undefined,
  directory: string,
  message: string,
  variant: "info" | "error"
): Promise<void> {
  const showToast = client?.tui?.showToast;
  if (!showToast) return;

  try {
    await showToast({
      directory,
      title: "Loadouts",
      message,
      variant,
      duration: 5000,
    });
  } catch {
    // Toast delivery is best-effort; command consumption should not depend on TUI availability.
  }
}

function runtimeStatePath(cwd: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheRoot, "loadouts", "opencode-runtime", `${key}.json`);
}

function readPersistedStates(cwd: string): Record<string, RuntimeState> {
  try {
    const file = runtimeStatePath(cwd);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, RuntimeState>;
  } catch {
    return {};
  }
}

function loadPersistedRuntimeState(cwd: string, sessionID: string): void {
  if (sessions.has(sessionID)) return;
  const state = readPersistedStates(cwd)[sessionID];
  if (state) sessions.set(sessionID, state);
}

function persistRuntimeState(cwd: string, sessionID: string): void {
  try {
    const file = runtimeStatePath(cwd);
    const states = readPersistedStates(cwd);
    const state = sessions.get(sessionID);
    if (state) states[sessionID] = state;
    else delete states[sessionID];

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(states, null, 2), "utf-8");
  } catch {
    // The in-memory runtime still works inside a long-lived OpenCode process.
  }
}

export const LoadoutsRuntimePlugin = async ({
  directory,
  worktree,
  client,
}: {
  directory: string;
  worktree: string;
  client?: OpenCodeClient;
}) => ({
  config: async (config: OpenCodeConfigInput) => {
    config.command ??= {};
    config.command.loadouts = {
      description: "Manage session-local Loadouts runtime activation",
      template: "",
    };
  },

  "command.execute.before": async (
    input: { command: string; sessionID: string; arguments: string },
    output: { parts: Array<{ type: "text"; text: string }> }
  ) => {
    if (input.command !== "loadouts") return;
    const cwd = directory || worktree || process.cwd();
    loadPersistedRuntimeState(cwd, input.sessionID);
    try {
      const text = await handle(input.arguments, input.sessionID, cwd);
      output.parts = [];
      persistRuntimeState(cwd, input.sessionID);
      await showRuntimeToast(client, cwd, text, "info");
      throw new LoadoutsRuntimeCommandHandledError(text);
    } catch (error) {
      if (error instanceof LoadoutsRuntimeCommandHandledError) throw error;

      const text = `runtime: error: ${error instanceof Error ? error.message : String(error)}`;
      output.parts = [];
      await showRuntimeToast(client, cwd, text, "error");
      throw new LoadoutsRuntimeCommandHandledError(text);
    }
  },

  "experimental.chat.system.transform": async (
    input: { sessionID?: string },
    output: { system: string[] }
  ) => {
    if (!input.sessionID) return;
    const cwd = directory || worktree || process.cwd();
    loadPersistedRuntimeState(cwd, input.sessionID);
    const state = sessions.get(input.sessionID);
    if (state) output.system.push(state.systemBlock);
  },
});

export default LoadoutsRuntimePlugin;
