import * as path from "node:path";
import * as os from "node:os";
import type { ToolSpec } from "../../core/registry.js";
import { selectAgentMarkdownMode } from "../agent-transforms.js";

export const cursorTool: ToolSpec = {
  name: "cursor",
  basePath: {
    global: path.join(os.homedir(), ".cursor"),
    project: ".cursor",
  },
  supports: ["rule", "skill", "instruction", "agent"],
  targets: {
    // Cursor rules render canonical paths/activation with native aliases.
    rule: {
      path: "{base}/rules/{stem}.mdc",
      transform: "cursor-rule-frontmatter",
    },
    skill: { path: "{base}/skills/{name}" },
    instruction: {
      path: { project: "AGENTS.md", global: "{home}/AGENTS.md" },
    },
    agent: {
      path: "{base}/agents/{stem}.md",
      mode: selectAgentMarkdownMode("cursor"),
      transform: "cursor-agent-frontmatter",
    },
  },
};
