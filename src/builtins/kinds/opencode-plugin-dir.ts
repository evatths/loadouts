import type { KindSpec } from "../../core/registry.js";

export const opencodePluginDirKind: KindSpec = {
  id: "opencode-plugin-dir",
  description: "Directory-based OpenCode plugin packages.",
  detect: (rel) =>
    rel.startsWith("opencode/plugins/") &&
    !rel.endsWith(".ts") &&
    !rel.endsWith(".tsx") &&
    !rel.endsWith(".js"),
  layout: "dir",
  defaultTargets: {},
};
