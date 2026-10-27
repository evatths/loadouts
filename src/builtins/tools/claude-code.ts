import * as path from "node:path";
import * as os from "node:os";
import type { ToolSpec } from "../../core/registry.js";
import { selectAgentMarkdownMode } from "../agent-transforms.js";

export const claudeCodeTool: ToolSpec = {
  name: "claude-code",
  basePath: {
    global: path.join(os.homedir(), ".claude"),
    project: ".claude",
  },
  supports: ["rule", "skill", "instruction", "agent"],
  targets: {
    rule: { path: "{base}/rules/{stem}.md" },
    skill: { path: "{base}/skills/{name}" },
    instruction: { path: { project: "AGENTS.md", global: "{base}/CLAUDE.md" } },
    agent: {
      path: "{base}/agents/{stem}.md",
      mode: selectAgentMarkdownMode("claude-code"),
      transform: "claude-agent-frontmatter",
    },
  },
  instructions: { suppressedBy: ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"] },
};
