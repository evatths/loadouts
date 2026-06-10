import type { KindSpec } from "../../core/registry.js";

export const opencodeCommandKind: KindSpec = {
  id: "opencode-command",
  description: "OpenCode slash command markdown files.",
  detect: (rel) => rel.startsWith("opencode/commands/") && rel.endsWith(".md"),
  layout: "file",
  defaultTargets: {},
};
