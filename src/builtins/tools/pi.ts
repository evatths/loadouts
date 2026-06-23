import * as path from "node:path";
import * as os from "node:os";
import type { ToolSpec } from "../../core/registry.js";

export const piTool: ToolSpec = {
  name: "pi",
  basePath: {
    global: path.join(os.homedir(), ".pi", "agent"),
    project: ".pi",
  },
  // Note: "rule" intentionally omitted - pi has no native rules concept.
  // Users can map rules to prompts if needed, or use a compatibility extension.
  supports: ["skill", "instruction", "prompt", "extension", "extension-dir", "theme"],
  targets: {
    skill: { path: "{base}/skills/{name}" },
    instruction: {
      path: { project: "AGENTS.md", global: "{home}/AGENTS.md" },
    },
    prompt: { path: "{base}/prompts/{stem}.md" },
    extension: { path: "{base}/extensions/{stem}.ts" },
    "extension-dir": { path: "{base}/extensions/{stem}", mode: "copy" },
    theme: { path: "{base}/themes/{stem}.json" },
  },
};
