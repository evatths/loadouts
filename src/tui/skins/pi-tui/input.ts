import { decodeKittyPrintable, Key, matchesKey, type KeyId } from "@earendil-works/pi-tui";
import { intentForKey, keymap } from "../../core/keymap.js";
import type { Intent } from "../../core/intent.js";
import type { ViewSpec } from "../../core/viewspec.js";

export function intentFromPiTuiInput(data: string, spec?: ViewSpec): Intent | undefined {
  if (spec?.footer.filter?.active) return filterIntentFromInput(data);

  const printable = decodeKittyPrintable(data) ?? (data.length === 1 ? data : undefined);
  for (const binding of keymap) {
    if (binding.mode === "filter") continue;
    for (const key of binding.keys) {
      if (printable === key || matchesKey(data, toPiTuiKey(key))) {
        return intentForKey(key);
      }
    }
  }
  return undefined;
}

function filterIntentFromInput(data: string): Intent | undefined {
  if (matchesKey(data, Key.escape)) return { t: "filterCancel" };
  if (matchesKey(data, Key.enter)) return { t: "filterCommit" };
  if (matchesKey(data, Key.backspace)) return { t: "filterBackspace" };

  const printable = decodeKittyPrintable(data) ?? (data.length === 1 ? data : undefined);
  return printable && printable.length === 1 && printable >= " " && printable !== "\u007f"
    ? { t: "filterChar", char: printable }
    : undefined;
}

export function isCtrlC(data: string): boolean {
  return matchesKey(data, Key.ctrl("c"));
}

function toPiTuiKey(key: string): KeyId {
  if (/^[A-Z]$/.test(key)) return `shift+${key.toLowerCase()}` as KeyId;
  return key as KeyId;
}
