import type { Intent } from "./intent.js";

export interface KeyBinding {
  keys: string[];
  label: string;
  intent: Intent;
  hint?: boolean;
  mode?: "normal" | "filter";
}

export const keymap: KeyBinding[] = [
  { keys: ["j", "down"], label: "move down", intent: { t: "move", delta: 1 } },
  { keys: ["k", "up"], label: "move up", intent: { t: "move", delta: -1 } },
  { keys: ["tab"], label: "next section", intent: { t: "section", dir: 1 } },
  { keys: ["shift+tab"], label: "prev section", intent: { t: "section", dir: -1 } },
  { keys: ["space"], label: "toggle", intent: { t: "toggle" }, hint: true },
  { keys: ["a"], label: "activate", intent: { t: "activate" }, hint: true },
  { keys: ["d"], label: "deactivate", intent: { t: "deactivate" }, hint: true },
  { keys: ["s"], label: "sync", intent: { t: "sync" }, hint: true },
  { keys: ["x"], label: "clear", intent: { t: "clear" }, hint: true },
  { keys: ["enter"], label: "details", intent: { t: "enter" } },
  { keys: ["D"], label: "diff", intent: { t: "diffPreview" }, hint: true },
  { keys: ["e"], label: "edit", intent: { t: "edit" }, hint: true },
  { keys: ["m"], label: "mode", intent: { t: "cycleMode" } },
  { keys: ["g"], label: "scope", intent: { t: "cycleScope" } },
  { keys: ["t"], label: "tool", intent: { t: "cycleTool" } },
  { keys: ["/"], label: "find", intent: { t: "filterStart" }, hint: true },
  { keys: ["u"], label: "undo", intent: { t: "undo" }, hint: true },
  { keys: ["r"], label: "refresh", intent: { t: "refresh" } },
  { keys: ["?"], label: "help", intent: { t: "openHelp" }, hint: true },
  { keys: ["esc"], label: "close/cancel", intent: { t: "closeOverlay" } },
  { keys: ["q"], label: "quit", intent: { t: "quit" } },
  { keys: ["printable"], label: "filter text", intent: { t: "filterChar", char: "" }, mode: "filter" },
  { keys: ["backspace"], label: "delete filter char", intent: { t: "filterBackspace" }, mode: "filter" },
  { keys: ["enter"], label: "commit filter", intent: { t: "filterCommit" }, mode: "filter" },
  { keys: ["esc"], label: "cancel filter", intent: { t: "filterCancel" }, mode: "filter" },
];

export function intentForKey(key: string): Intent | undefined {
  return keymap.find((binding) => binding.mode !== "filter" && binding.keys.includes(key))?.intent;
}

export function footerKeyHints(): { key: string; label: string }[] {
  return keymap
    .filter((binding) => binding.mode !== "filter" && binding.hint)
    .map((binding) => ({ key: binding.keys[0], label: binding.label }));
}
