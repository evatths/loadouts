import type { KindSpec } from "../../core/registry.js";

export const opencodeTuiConfigKind: KindSpec = {
  id: "opencode-tui-config",
  description: "Whole-file OpenCode TUI configuration.",
  detect: (rel) => rel === "opencode/tui.json" || rel === "opencode/tui.jsonc",
  layout: "file",
  defaultTargets: {},
};
