import * as path from "node:path";
import * as os from "node:os";
import type { ToolSpec } from "../../core/registry.js";
import { selectAgentMarkdownMode } from "../agent-transforms.js";

export const opencodeTool: ToolSpec = {
  name: "opencode",
  basePath: {
    global: path.join(os.homedir(), ".config", "opencode"),
    project: ".opencode",
  },
  supports: [
    "rule",
    "skill",
    "instruction",
    "agent",
    "opencode-config",
    "opencode-plugin",
  ],
  targets: {
    rule: {
      path: "{base}/rules/{stem}.md",
      transform: "opencode-rule-frontmatter",
    },
    skill: {
      path: "{base}/skills/{name}",
      transform: "opencode-skill-frontmatter",
    },
    instruction: {
      path: { project: "AGENTS.md", global: "{home}/AGENTS.md" },
    },
    agent: {
      path: "{base}/agents/{stem}.md",
      mode: selectAgentMarkdownMode("opencode"),
      transform: "opencode-agent-frontmatter",
    },
    "opencode-config": {
      path: {
        project: "opencode{ext}",
        global: "{base}/opencode{ext}",
      },
    },
    "opencode-plugin": { path: "{base}/plugins/{stem}{ext}" },
  },
};
