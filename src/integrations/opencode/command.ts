import type { Scope } from "../../core/types.js";

export type EquipCommand = { action: "equip"; names: string[]; scope: Scope }
  | { action: "dashboard" | "quick" | "status" | "unequip" | "list" };

/** Shared slash grammar. Loadout names are unquoted identifiers, never shell input. */
export function parseEquipCommand(input = ""): EquipCommand {
  const [action = "dashboard", ...args] = input.trim().split(/\s+/).filter(Boolean);
  if (action === "equip") {
    const global = args.includes("-g") || args.includes("--global");
    const project = args.includes("-p") || args.includes("--project");
    if (global && project) throw new Error("Choose --global or --project.");
    const flags = new Set(["-g", "--global", "-p", "--project"]);
    const names = args.filter((arg) => !flags.has(arg));
    if (!names.length || names.some((name) => name.startsWith("-"))) throw new Error("Usage: /loadouts equip <names…> [-g|-p]");
    return { action, names, scope: global ? "global" : "project" };
  }
  if (["dashboard", "quick", "status", "unequip", "list"].includes(action) && !args.length) return { action: action as "dashboard" | "quick" | "status" | "unequip" | "list" };
  throw new Error("Usage: /loadouts [equip <names…> [-g|-p] | unequip | status | list | quick]");
}
