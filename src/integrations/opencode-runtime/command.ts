import {
  clearRuntimeSessionState,
  getRuntimeSessionState,
  renderInjectedSystemBlock,
  renderRuntimeStateSummary,
  setRuntimeSessionState,
} from "./state.js";
import type {
  HandleRuntimeCommandOptions,
  HandleRuntimeCommandResult,
  ParsedRuntimeCommand,
  RuntimeCommandAction,
  RuntimeScope,
} from "./types.js";

const COMMAND_ALIASES: Record<string, RuntimeCommandAction> = {
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

const SCOPE_COMMANDS = new Set<RuntimeCommandAction>(["activate", "list", "info"]);

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === "\\" && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    if (ch === "\\" && i + 1 < text.length) {
      current += text[i + 1];
      i += 1;
      continue;
    }

    current += ch;
  }

  if (quote) {
    throw new Error("Unterminated quote in runtime command arguments.");
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

function parseScope(tokens: string[], action: RuntimeCommandAction): { scope: RuntimeScope; names: string[] } {
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

  if ((local || global) && !SCOPE_COMMANDS.has(action)) {
    throw new Error("Scope flags are only supported for activate, list, and info.");
  }
  if (local && global) {
    throw new Error("Use either --local or --global, not both.");
  }

  return {
    scope: global ? "global" : "local",
    names,
  };
}

export function parseRuntimeCommand(argumentsText: string): ParsedRuntimeCommand {
  const tokens = tokenize(argumentsText.trim());
  if (tokens.length === 0) {
    return { action: "status", names: [], scope: "local" };
  }

  const actionToken = tokens[0].toLowerCase();
  const action = COMMAND_ALIASES[actionToken];
  if (!action) {
    throw new Error(`Unknown runtime command: ${tokens[0]}`);
  }

  const parsed = parseScope(tokens.slice(1), action);

  if (action === "activate" && parsed.names.length === 0) {
    throw new Error("activate requires at least one loadout name.");
  }
  if (action === "list" && parsed.names.length > 0) {
    throw new Error("list does not accept loadout names.");
  }
  if ((action === "status" || action === "show" || action === "system-block" || action === "help") && parsed.names.length > 0) {
    throw new Error(`${action} does not accept loadout names.`);
  }

  return {
    action,
    names: parsed.names,
    scope: parsed.scope,
  };
}

function helpText(): string {
  return [
    "runtime commands:",
    "  (empty|status|s)",
    "  activate|a|use <names...> [-l|--local|-g|--global]",
    "  deactivate|d|remove|rm|clear",
    "  list|ls [-l|--local|-g|--global]",
    "  info|i [names...] [-l|--local|-g|--global]",
    "  show",
    "  system-block",
    "  help|-h|--help",
  ].join("\n");
}

function shortFingerprint(fingerprint: string): string {
  return fingerprint.replace(/^sha256:/, "").slice(0, 12);
}

export async function handleRuntimeCommand(
  options: HandleRuntimeCommandOptions
): Promise<HandleRuntimeCommandResult> {
  const command = parseRuntimeCommand(options.argumentsText);

  if (command.action === "help") {
    return { command, text: helpText() };
  }

  if (command.action === "activate") {
    const compiled = await options.bridge.compile(command.names, command.scope, options.cwd);
    const activatedAt = options.now ? options.now() : new Date().toISOString();

    setRuntimeSessionState(options.store, options.sessionID, {
      activeNames: command.names,
      bundle: compiled.bundle,
      systemBlock: compiled.systemBlock,
      activatedAt,
    });

    return {
      command,
      text: `runtime: activated (${command.scope}) ${command.names.join(", ")} [${shortFingerprint(compiled.bundle.fingerprint)}]`,
    };
  }

  if (command.action === "deactivate") {
    const hadState = clearRuntimeSessionState(options.store, options.sessionID);
    return {
      command,
      text: hadState ? "runtime: deactivated" : "runtime: already inactive",
    };
  }

  if (command.action === "list") {
    const text = (await options.bridge.list(command.scope, options.cwd)).trim();
    return { command, text: text || "runtime: no loadouts" };
  }

  if (command.action === "info") {
    const text = (await options.bridge.info(command.names, command.scope, options.cwd)).trim();
    return { command, text: text || "runtime: no info" };
  }

  const state = getRuntimeSessionState(options.store, options.sessionID);
  if (command.action === "status") {
    if (!state) {
      return { command, text: "runtime: inactive" };
    }
    return {
      command,
      text: `runtime: active ${state.activeNames.join(", ")} [${shortFingerprint(state.bundle.fingerprint)}]`,
    };
  }

  if (command.action === "show") {
    if (!state) {
      return { command, text: "runtime: inactive" };
    }
    return { command, text: renderRuntimeStateSummary(state) };
  }

  if (command.action === "system-block") {
    const block = renderInjectedSystemBlock(state);
    return {
      command,
      text: block || "runtime: inactive (no system block)",
    };
  }

  return { command, text: "runtime: unsupported command" };
}
