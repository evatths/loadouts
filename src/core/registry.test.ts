import { describe, it, expect, beforeEach } from "vitest";
import { Registry } from "./registry.js";
import { ruleKind } from "../builtins/kinds/rule.js";
import { skillKind } from "../builtins/kinds/skill.js";
import { instructionKind } from "../builtins/kinds/instruction.js";
import { opencodeConfigKind } from "../builtins/kinds/opencode-config.js";
import { opencodePluginKind } from "../builtins/kinds/opencode-plugin.js";
import { claudeCodeTool } from "../builtins/tools/claude-code.js";
import { cursorTool } from "../builtins/tools/cursor.js";
import { opencodeTool } from "../builtins/tools/opencode.js";

let reg: Registry;

beforeEach(() => {
  reg = new Registry();
  reg.registerKind(ruleKind);
  reg.registerKind(skillKind);
  reg.registerKind(instructionKind);
  reg.registerKind(opencodeConfigKind);
  reg.registerKind(opencodePluginKind);
});

describe("Registry.inferKind", () => {
  it("infers rule kind", () => {
    expect(reg.inferKind("rules/typescript.md")).toBe("rule");
  });

  it("infers skill kind", () => {
    expect(reg.inferKind("skills/deploy")).toBe("skill");
  });

  it("infers instruction kind", () => {
    expect(reg.inferKind("instructions/AGENTS.base.md")).toBe("instruction");
  });

  it("infers OpenCode config kind", () => {
    expect(reg.inferKind("opencode/opencode.jsonc")).toBe("opencode-config");
    expect(reg.inferKind("opencode/opencode.json")).toBe("opencode-config");
  });

  it("infers OpenCode plugin kind", () => {
    expect(reg.inferKind("opencode/plugins/notify.ts")).toBe("opencode-plugin");
    expect(reg.inferKind("opencode/plugins/notify.js")).toBe("opencode-plugin");
  });

  it("returns undefined for unknown path", () => {
    expect(reg.inferKind("unknown/path.md")).toBeUndefined();
  });
});

describe("Registry.resolveMapping", () => {
  beforeEach(() => {
    reg.registerTool(claudeCodeTool);
    reg.registerTool(cursorTool);
    reg.registerTool(opencodeTool);
  });

  it("resolves claude-code rule mapping", () => {
    const m = reg.resolveMapping("claude-code", "rule");
    expect(m).toBeDefined();
    expect(m!.path).toBe("{base}/rules/{stem}.md");
  });

  it("resolves cursor rule mapping with mdc extension", () => {
    const m = reg.resolveMapping("cursor", "rule");
    expect(m).toBeDefined();
    expect(m!.path).toBe("{base}/rules/{stem}.mdc");
    expect(m!.transform).toBe("cursor-rule-frontmatter");
  });

  it("returns undefined when tool doesn't support kind", () => {
    // claude-code supports rule, skill, instruction — not a custom kind
    const m = reg.resolveMapping("claude-code", "unknown-kind");
    expect(m).toBeUndefined();
  });

  it("resolves OpenCode plugin mapping", () => {
    const m = reg.resolveMapping("opencode", "opencode-plugin");
    expect(m).toEqual({ path: "{base}/plugins/{stem}{ext}" });
  });

  it("resolves OpenCode config mapping", () => {
    const m = reg.resolveMapping("opencode", "opencode-config");
    expect(m).toEqual({
      path: {
        project: "opencode{ext}",
        global: "{base}/opencode{ext}",
      },
    });
  });

  it("does not expose OpenCode-only kinds to other tools", () => {
    expect(reg.resolveMapping("claude-code", "opencode-plugin")).toBeUndefined();
    expect(reg.resolveMapping("cursor", "opencode-config")).toBeUndefined();
  });

  it("does not require stale OpenCode plugin validation", () => {
    expect(opencodeTool.validate).toBeUndefined();
  });

  it("throws on duplicate kind registration", () => {
    expect(() => reg.registerKind(ruleKind)).toThrow(/already registered/);
  });

  it("throws on duplicate tool registration", () => {
    expect(() => reg.registerTool(claudeCodeTool)).toThrow(/already registered/);
  });
});

describe("Registry.resolveMapping — defaultTargets fallback", () => {
  it("falls back to kind.defaultTargets when tool has no override", () => {
    const customKind = {
      id: "myteam.prompt",
      detect: (rel: string) => rel.startsWith("prompts/"),
      layout: "file" as const,
      defaultTargets: {
        "claude-code": { path: "{base}/prompts/{stem}.md" },
      },
    };
    reg.registerKind(customKind);

    // Register a tool that supports the custom kind but has no target override
    reg.registerTool({
      name: "claude-code",
      basePath: { global: "/tmp/global", project: ".claude" },
      supports: ["rule", "skill", "instruction", "myteam.prompt"],
    });

    const m = reg.resolveMapping("claude-code", "myteam.prompt");
    expect(m).toBeDefined();
    expect(m!.path).toBe("{base}/prompts/{stem}.md");
  });
});
