import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { runMigrateAgents } from "./migrate.js";
import type { CommandContext } from "../../core/types.js";

let tempDir: string | undefined;

function setupProject(): { projectRoot: string; loadoutPath: string; ctx: CommandContext } {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-migrate-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutPath = path.join(projectRoot, ".loadouts");
  fs.mkdirSync(path.join(loadoutPath, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(loadoutPath, "opencode", "agents"), { recursive: true });
  fs.mkdirSync(path.join(loadoutPath, "kinds"), { recursive: true });

  fs.writeFileSync(
    path.join(loadoutPath, "loadouts", "base.yaml"),
    yaml.stringify({
      name: "base",
      tools: ["opencode", "cursor", "claude-code", "codex"],
      include: ["opencode/agents/reviewer.md"],
    })
  );
  fs.writeFileSync(
    path.join(loadoutPath, "opencode", "agents", "reviewer.md"),
    `---
description: OpenCode reviewer.
mode: subagent
model: openai/gpt-5.5
reasoningEffort: medium
permission:
  edit: deny
---

Review like an owner.
`
  );
  fs.writeFileSync(
    path.join(loadoutPath, "kinds", "opencode-agent.yaml"),
    "id: opencode-agent\n"
  );

  return {
    projectRoot,
    loadoutPath,
    ctx: {
      scope: "project",
      configPath: loadoutPath,
      statePath: path.join(loadoutPath, ".state.json"),
      projectRoot,
    },
  };
}

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("runMigrateAgents", () => {
  it("migrates in-place OpenCode custom-kind agents to canonical agents", async () => {
    const { loadoutPath, ctx } = setupProject();

    const result = await runMigrateAgents(ctx, undefined, { keep: false, force: false });

    expect(result.skipped).toEqual([]);
    expect(result.migrated).toHaveLength(1);
    expect(fs.existsSync(path.join(loadoutPath, "opencode", "agents", "reviewer.md"))).toBe(false);

    const canonicalPath = path.join(loadoutPath, "agents", "reviewer.md");
    expect(fs.existsSync(canonicalPath)).toBe(true);
    const canonical = fs.readFileSync(canonicalPath, "utf-8");
    expect(canonical).toContain("name: reviewer");
    expect(canonical).toContain("readonly: true");
    expect(canonical).toContain("opencode:");
    expect(canonical).toContain("mode: subagent");
    expect(canonical).toContain("codex:");
    expect(canonical).toContain("model_reasoning_effort: medium");
    expect(canonical).toContain("Review like an owner.");

    const loadout = yaml.parse(
      fs.readFileSync(path.join(loadoutPath, "loadouts", "base.yaml"), "utf-8")
    );
    expect(loadout.include).toEqual([
      { path: "agents/reviewer.md", tools: ["opencode"] },
    ]);
  });
});
