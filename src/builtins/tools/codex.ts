import * as path from "node:path";
import * as os from "node:os";
import type { ToolSpec } from "../../core/registry.js";

export const codexTool: ToolSpec = {
  name: "codex",
  basePath: {
    global: path.join(os.homedir(), ".agents"),
    project: ".agents",
  },
  supports: ["skill", "instruction", "agent"],
  targets: {
    skill: { path: "{base}/skills/{name}" },
    instruction: {
      path: { project: "AGENTS.md", global: "{home}/AGENTS.md" },
    },
    agent: {
      path: {
        project: ".codex/agents/{stem}.toml",
        global: "{home}/.codex/agents/{stem}.toml",
      },
      ext: ".toml",
      mode: "copy",
      transform: "codex-agent-toml",
    },
  },
};
