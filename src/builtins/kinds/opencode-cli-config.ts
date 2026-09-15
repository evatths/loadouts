import type { KindSpec } from "../../core/registry.js";

export const opencodeCliConfigKind: KindSpec = {
  id: "opencode-cli-config",
  // OpenCode V2 renamed this file to cli.json; it is global-only, with no
  // project-local equivalent (opencode.ai/v2/docs/cli/config).
  description: "Whole-file OpenCode CLI configuration (global-only).",
  detect: (rel) => rel === "opencode/cli.json" || rel === "opencode/cli.jsonc",
  layout: "file",
  defaultTargets: {},
};
