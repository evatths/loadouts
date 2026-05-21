/**
 * Built-in plugin — registers the three core kinds, four core tools, and
 * all named transforms. Called once at CLI startup before any command runs.
 *
 * Built-ins use the same PluginAPI as external plugins; there is no
 * privileged code path.
 */

import type { PluginAPI } from "../core/plugin.js";
import {
  parseMarkdownFrontmatter,
  serializeMarkdownFrontmatter,
} from "../core/config.js";
import { ruleKind } from "./kinds/rule.js";
import { skillKind } from "./kinds/skill.js";
import { instructionKind } from "./kinds/instruction.js";
import { promptKind } from "./kinds/prompt.js";
import { extensionKind } from "./kinds/extension.js";
import { themeKind } from "./kinds/theme.js";
import { opencodeConfigKind } from "./kinds/opencode-config.js";
import { opencodePluginKind } from "./kinds/opencode-plugin.js";
import { claudeCodeTool } from "./tools/claude-code.js";
import { cursorTool } from "./tools/cursor.js";
import { opencodeTool } from "./tools/opencode.js";
import { codexTool } from "./tools/codex.js";
import { piTool } from "./tools/pi.js";

/** Names of the built-in tools, for use in defaults and display. */
export const BUILTIN_TOOL_NAMES = [
  "claude-code",
  "cursor",
  "opencode",
  "codex",
  "pi",
] as const;

export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number];

function translateRuleFrontmatter(raw: string): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);

  const paths = Array.isArray(frontmatter.paths) ? frontmatter.paths : undefined;
  if (paths && !Array.isArray(frontmatter.globs)) {
    frontmatter.globs = paths;
  }

  if (typeof frontmatter.activation === "string" && frontmatter.alwaysApply === undefined) {
    if (frontmatter.activation === "always") frontmatter.alwaysApply = true;
    if (frontmatter.activation === "scoped") frontmatter.alwaysApply = false;
  }

  return serializeMarkdownFrontmatter(frontmatter, body);
}

function translateOpenCodeSkillFrontmatter(raw: string): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);

  const modelInvocable = frontmatter["model-invocable"];
  if (
    typeof modelInvocable === "boolean" &&
    frontmatter["disable-model-invocation"] === undefined
  ) {
    frontmatter["disable-model-invocation"] = !modelInvocable;
  }

  return serializeMarkdownFrontmatter(frontmatter, body);
}

/** Register all built-ins into the given PluginAPI. */
export function registerBuiltins(api: PluginAPI): void {
  // Kinds first — tools reference kind IDs in their `supports` arrays.
  api.registerKind(ruleKind);
  api.registerKind(skillKind);
  api.registerKind(instructionKind);
  api.registerKind(promptKind);
  api.registerKind(extensionKind);
  api.registerKind(themeKind);
  api.registerKind(opencodeConfigKind);
  api.registerKind(opencodePluginKind);

  // Named transforms — referenced by name in tool target specs.
  api.registerTransform("cursor-rule-frontmatter", translateRuleFrontmatter);
  api.registerTransform("opencode-rule-frontmatter", translateRuleFrontmatter);
  api.registerTransform("opencode-skill-frontmatter", translateOpenCodeSkillFrontmatter);

  // Tools
  api.registerTool(claudeCodeTool);
  api.registerTool(cursorTool);
  api.registerTool(opencodeTool);
  api.registerTool(codexTool);
  api.registerTool(piTool);
}
