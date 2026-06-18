import { describe, expect, it } from "vitest";
import { canonicalizeAgentContent } from "./agent-migration.js";

describe("agent migration", () => {
  it("migrates OpenCode agents to canonical targets and compatible analogs", () => {
    const result = canonicalizeAgentContent(
      `---
description: Deep review agent.
mode: subagent
model: openai/gpt-5.5
reasoningEffort: high
steps: 8
permission:
  edit: deny
  bash: deny
aliases: []
id: reviewer
tags: []
---

Review deeply.
`,
      { harness: "opencode", sourcePath: "/tmp/reviewer.md" }
    );

    expect(result.name).toBe("reviewer");
    expect(result.content).toContain("name: reviewer");
    expect(result.content).toContain("description: Deep review agent.");
    expect(result.content).toContain("readonly: true");
    expect(result.content).toContain("opencode:");
    expect(result.content).toContain("mode: subagent");
    expect(result.content).toContain("model: openai/gpt-5.5");
    expect(result.content).toContain("reasoningEffort: high");
    expect(result.content).toContain("codex:");
    expect(result.content).toContain("model_reasoning_effort: high");
    expect(result.content).toContain("claude-code:");
    expect(result.content).toContain("effort: high");
    expect(result.content).toContain("maxTurns: 8");
    expect(result.content).not.toContain("aliases:");
    expect(result.content).not.toContain("id: reviewer");
    expect(result.content).not.toContain("tags:");
  });

  it("migrates Cursor agents to portable readonly and background fields", () => {
    const result = canonicalizeAgentContent(
      `---
name: verifier
description: Validates completed work.
model: gpt-5.5
readonly: true
is_background: true
---

Verify skeptically.
`,
      { harness: "cursor", sourcePath: "/tmp/verifier.md" }
    );

    expect(result.content).toContain("name: verifier");
    expect(result.content).toContain("readonly: true");
    expect(result.content).toContain("background: true");
    expect(result.content).toContain("cursor:");
    expect(result.content).toContain("model: gpt-5.5");
    expect(result.content).not.toContain("is_background:");
  });

  it("migrates Claude agents to canonical overlays and step analogs", () => {
    const result = canonicalizeAgentContent(
      `---
name: planner
description: Plans work.
permissionMode: plan
tools: Read, Glob, Grep
maxTurns: 5
effort: medium
background: false
---

Plan only.
`,
      { harness: "claude-code", sourcePath: "/tmp/planner.md" }
    );

    expect(result.content).toContain("readonly: true");
    expect(result.content).toContain("background: false");
    expect(result.content).toContain("claude-code:");
    expect(result.content).toContain("permissionMode: plan");
    expect(result.content).toContain("tools: Read, Glob, Grep");
    expect(result.content).toContain("opencode:");
    expect(result.content).toContain("steps: 5");
    expect(result.content).toContain("reasoningEffort: medium");
    expect(result.content).toContain("codex:");
    expect(result.content).toContain("model_reasoning_effort: medium");
  });

  it("migrates Codex TOML agents to Markdown with developer instructions as body", () => {
    const result = canonicalizeAgentContent(
      `name = "explorer"
description = "Explores code."
model = "gpt-5.5"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Explore and report evidence.
"""
`,
      { harness: "codex", sourcePath: "/tmp/explorer.toml" }
    );

    expect(result.name).toBe("explorer");
    expect(result.content).toContain("name: explorer");
    expect(result.content).toContain("description: Explores code.");
    expect(result.content).toContain("readonly: true");
    expect(result.content).toContain("codex:");
    expect(result.content).toContain("model: gpt-5.5");
    expect(result.content).toContain("model_reasoning_effort: high");
    expect(result.content).toContain("sandbox_mode: read-only");
    expect(result.content).toContain("claude-code:");
    expect(result.content).toContain("effort: high");
    expect(result.content).toContain("opencode:");
    expect(result.content).toContain("reasoningEffort: high");
    expect(result.content).toContain("Explore and report evidence.");
    expect(result.content).not.toContain("developer_instructions");
  });
});
