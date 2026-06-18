/** @jsxImportSource @opentui/solid */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";

type RuntimeUiEvent = {
  id: string;
  sessionID: string;
  title: string;
  message: string;
  variant: "info" | "success" | "error";
  createdAt: string;
};

function readValue(value: unknown): unknown {
  if (typeof value !== "function") return value;
  try {
    return (value as () => unknown)();
  } catch {
    return undefined;
  }
}

function getPath(root: unknown, keys: string[]): unknown {
  let current = root;
  for (const key of keys) {
    current = readValue(current);
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return readValue(current);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const resolved = readValue(value);
    if (typeof resolved === "string" && resolved.trim().length > 0) return resolved;
  }
  return undefined;
}

function resolveSessionID(api: TuiPluginApi, commandInputs: unknown[]): string | undefined {
  for (const input of commandInputs) {
    const direct = firstString(
      getPath(input, ["sessionID"]),
      getPath(input, ["sessionId"]),
      getPath(input, ["session", "id"]),
      getPath(input, ["session", "sessionID"]),
      getPath(input, ["ctx", "sessionID"]),
      getPath(input, ["ctx", "session", "id"])
    );
    if (direct) return direct;
  }

  const state = (api as unknown as { state?: unknown }).state;
  return firstString(
    getPath(state, ["sessionID"]),
    getPath(state, ["sessionId"]),
    getPath(state, ["session", "id"]),
    getPath(state, ["session", "sessionID"]),
    getPath(state, ["session", "current", "id"]),
    getPath(state, ["session", "current", "sessionID"]),
    getPath(state, ["currentSession", "id"]),
    getPath(state, ["currentSession", "sessionID"])
  );
}

function resolveCwd(api: TuiPluginApi): string {
  const state = (api as unknown as { state?: unknown }).state;
  return path.resolve(
    firstString(
      getPath(state, ["project", "root"]),
      getPath(state, ["project", "directory"]),
      getPath(state, ["project", "cwd"]),
      getPath(state, ["workspace", "root"]),
      getPath(state, ["directory"]),
      getPath(state, ["worktree"]),
      getPath(state, ["cwd"])
    ) ?? process.cwd()
  );
}

function runtimeEventPath(cwd: string): string {
  const cacheRoot = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const key = crypto.createHash("sha256").update(path.resolve(cwd)).digest("hex").slice(0, 32);
  return path.join(cacheRoot, "loadouts", "opencode-runtime", `${key}.event.json`);
}

function readRuntimeUiEvents(cwd: string): Record<string, RuntimeUiEvent> {
  try {
    const file = runtimeEventPath(cwd);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, RuntimeUiEvent>;
  } catch {
    return {};
  }
}

function latestEvent(events: RuntimeUiEvent[]): RuntimeUiEvent | undefined {
  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
}

function openDialog(api: TuiPluginApi, title: string, text: string, variant: "info" | "success" | "error") {
  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => {
    const theme = api.theme.current;
    const accent = variant === "error" ? theme.error : variant === "success" ? theme.success : theme.info;

    return (
      <box
        width={86}
        border
        borderColor={accent}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
        flexDirection="column"
      >
        <text fg={theme.text}>
          <b>{title}</b>
        </text>
        <text fg={theme.textMuted}>TUI-only runtime feedback. The assistant cannot see this dialog.</text>
        <box border borderColor={theme.border} paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.text}>{text}</text>
        </box>
        <text fg={theme.textMuted}>Press escape to close.</text>
      </box>
    );
  });
}

function latestVisibleEvent(api: TuiPluginApi): RuntimeUiEvent | undefined {
  const events = Object.values(readRuntimeUiEvents(resolveCwd(api)));
  if (events.length === 0) return undefined;

  const sessionID = resolveSessionID(api, []);
  if (sessionID) {
    const event = events.find((item) => item.sessionID === sessionID);
    if (event) return event;
  }

  return latestEvent(events);
}

const tui: TuiPlugin = async (api) => {
  let seenEventID = latestVisibleEvent(api)?.id;

  setInterval(() => {
    const event = latestVisibleEvent(api);
    if (!event || event.id === seenEventID) return;
    seenEventID = event.id;
    openDialog(api, event.title, event.message, event.variant);
  }, 300);
};

const plugin: TuiPluginModule & { id: string } = {
  id: "loadouts-runtime-tui",
  tui,
};

export default plugin;
