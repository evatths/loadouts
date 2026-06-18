import type { KindSpec } from "../../core/registry.js";

export const opencodePluginKind: KindSpec = {
  id: "opencode-plugin",
  description: "Local OpenCode plugin modules.",
  detect: (rel) =>
    rel.startsWith("opencode/plugins/") &&
    (rel.endsWith(".ts") || rel.endsWith(".tsx") || rel.endsWith(".js")),
  layout: "file",
  defaultTargets: {},
};
