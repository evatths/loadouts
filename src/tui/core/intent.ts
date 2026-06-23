import type { ActivationMode, ScopeFilter } from "./model.js";

export type Intent =
  | { t: "move"; delta: number }
  | { t: "section"; dir: 1 | -1 }
  | { t: "toggle" }
  | { t: "activate" }
  | { t: "deactivate" }
  | { t: "sync" }
  | { t: "clear" }
  | { t: "diffPreview" }
  | { t: "edit" }
  | { t: "enter" }
  | { t: "filterStart" }
  | { t: "filterInput"; text: string }
  | { t: "filterChar"; char: string }
  | { t: "filterBackspace" }
  | { t: "filterCommit" }
  | { t: "filterCancel" }
  | { t: "cycleScope" }
  | { t: "cycleTool" }
  | { t: "cycleMode" }
  | { t: "undo" }
  | { t: "refresh" }
  | { t: "openHelp" }
  | { t: "closeOverlay" }
  | { t: "quit" }
  | {
      t: "effectDone";
      effect: Effect["t"];
      ok: boolean;
      message?: string;
      data?: string[];
    };

export type Effect =
  | { t: "apply"; targetSet: string[]; mode: ActivationMode; scope: ScopeFilter }
  | { t: "clear"; mode: ActivationMode; scope: ScopeFilter }
  | { t: "plan"; targetSet: string[]; scope: ScopeFilter }
  | { t: "reload" }
  | { t: "editFile"; path: string };
