import type { Intent } from "./intent.js";
import type { Model } from "./model.js";
import { cursorRow, rowLayer } from "./selection.js";

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
  { keys: ["tab", "l", "right"], label: "next section", intent: { t: "section", dir: 1 } },
  { keys: ["shift+tab", "h", "left"], label: "prev section", intent: { t: "section", dir: -1 } },
  { keys: ["1"], label: "Active section", intent: { t: "selectSection", section: "active" } },
  { keys: ["2"], label: "Available section", intent: { t: "selectSection", section: "available" } },
  { keys: ["3"], label: "Issues section", intent: { t: "selectSection", section: "issues" } },
  { keys: ["["], label: "prev scope tab", intent: { t: "cycleScope", dir: -1 } },
  { keys: ["]"], label: "next scope tab", intent: { t: "cycleScope", dir: 1 } },
  { keys: ["g"], label: "first row (gg)", intent: { t: "topPrefix" } },
  { keys: ["home"], label: "first row", intent: { t: "edge", edge: "first" } },
  { keys: ["G", "end"], label: "last row", intent: { t: "edge", edge: "last" } },
  { keys: ["pageup"], label: "scroll details up", intent: { t: "detailScroll", delta: -5 } },
  { keys: ["pagedown"], label: "scroll details down", intent: { t: "detailScroll", delta: 5 } },
  { keys: ["space"], label: "toggle", intent: { t: "toggle" }, hint: true },
  { keys: ["a"], label: "activate", intent: { t: "activate" }, hint: true },
  { keys: ["d"], label: "deactivate", intent: { t: "deactivate" }, hint: true },
  { keys: ["s"], label: "sync", intent: { t: "sync" }, hint: true },
  { keys: ["x"], label: "clear", intent: { t: "clear" }, hint: true },
  { keys: ["enter"], label: "details", intent: { t: "enter" } },
  { keys: ["D"], label: "diff", intent: { t: "diffPreview" }, hint: true },
  { keys: ["e"], label: "edit", intent: { t: "edit" }, hint: true },
  { keys: ["m"], label: "filesystem/session", intent: { t: "cycleMode" }, hint: true },
  { keys: ["S"], label: "choose session", intent: { t: "selectSession" } },
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

export function footerKeyHints(model: Model): { key: string; label: string }[] {
  if (model.overlay === "confirm") return [{ key: "h/l", label: "scope" }, { key: "enter", label: "confirm" }, { key: "esc", label: "cancel" }];
  if (model.overlay) return [{ key: "j/k", label: "scroll" }, { key: "esc", label: "close" }];
  if (model.filtering) return [{ key: "enter", label: "keep filter" }, { key: "esc", label: "clear filter" }];
  const row = cursorRow(model);
  const active = row && row.equipped.includes(rowLayer(model, row));
  const keys = keymap
    .filter((binding) => binding.mode !== "filter" && binding.hint)
    .filter(({ intent }) => {
      if (["activate", "deactivate", "toggle"].includes(intent.t)) {
        return row && row.status !== "broken" && (intent.t === "toggle" || (intent.t === "deactivate" ? active : !active));
      }
      if (intent.t === "edit") return Boolean(row?.filePath);
      if (intent.t === "cycleMode") return model.sessionAvailable;
      if (intent.t === "undo") return Boolean(model.undo);
      return true;
    })
    .map((binding) => ({ key: binding.keys[0], label: binding.label }));
  return [{ key: "h/l", label: "section" }, { key: "[/]", label: "scope" }, { key: "?", label: "help" }, ...keys.filter((key) => key.key !== "?")];
}
