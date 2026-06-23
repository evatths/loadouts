import type { KeyEvent } from "@opencode-ai/plugin/tui";
import { intentForKey } from "../../core/keymap.js";
import type { Intent } from "../../core/intent.js";
import type { ViewSpec } from "../../core/viewspec.js";

export function intentFromOpenTuiKey(event: KeyEvent, spec?: ViewSpec): Intent | undefined {
  if (event.ctrl && event.name?.toLowerCase() === "c") return { t: "quit" };
  if (spec?.footer.filter?.active) return filterIntentFromKey(event);
  return intentForKey(normalizeKey(event));
}

export function intentNameForKey(key: string): string {
  return `loadouts.dashboard.${key.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

export function keyForIntentCommand(commandName: string): Intent | undefined {
  const prefix = "loadouts.dashboard.";
  if (!commandName.startsWith(prefix)) return undefined;
  return intentForKey(commandName.slice(prefix.length).replace(/-/g, "+"));
}

function filterIntentFromKey(event: KeyEvent): Intent | undefined {
  const key = normalizeKey(event);
  if (key === "esc") return { t: "filterCancel" };
  if (key === "enter") return { t: "filterCommit" };
  if (key === "backspace") return { t: "filterBackspace" };

  const printable = printableChar(event);
  return printable ? { t: "filterChar", char: printable } : undefined;
}

function normalizeKey(event: KeyEvent): string {
  const name = event.name?.toLowerCase?.() ?? "";
  if (name === "return") return "enter";
  if (name === "escape") return "esc";
  if (name === "delete") return "backspace";
  if (name === "tab" && event.shift) return "shift+tab";
  if (name === "space" || event.sequence === " ") return "space";
  if (name === "up" || name === "down" || name === "tab" || name === "enter" || name === "esc" || name === "backspace") return name;
  if (event.shift && name === "d") return "D";

  const printable = printableChar(event);
  return printable ?? name;
}

function printableChar(event: KeyEvent): string | undefined {
  if (event.ctrl || event.meta || event.option) return undefined;
  const raw = event.sequence || event.raw;
  if (raw && raw.length === 1 && raw >= " " && raw !== "\u007f") return raw;
  if (event.name && event.name.length === 1) return event.shift ? event.name.toUpperCase() : event.name;
  return undefined;
}
