import type { KindSpec } from "../../core/registry.js";

export const extensionDirKind: KindSpec = {
  id: "extension-dir",
  description: "Directory-based runtime extensions with package metadata.",
  detect: (rel) => rel.startsWith("extensions/") && !rel.endsWith(".ts") && !rel.endsWith(".js"),
  layout: "dir",
  defaultTargets: {},
};
