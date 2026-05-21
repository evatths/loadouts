import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { runAddTo } from "./add-to.js";
import { runRemoveFrom } from "./remove-from.js";
import { normalizeIncludePath, parseToolsOption } from "./loadout-include.js";

let tempDir: string | undefined;

function setupProject(include: unknown[] = []): { projectRoot: string; loadoutRoot: string } {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-assembly-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutRoot = path.join(projectRoot, ".loadouts");

  fs.mkdirSync(path.join(loadoutRoot, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "rules"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "skills", "debugger"), { recursive: true });

  fs.writeFileSync(path.join(loadoutRoot, "rules", "api.md"), "# API\n");
  fs.writeFileSync(path.join(loadoutRoot, "skills", "debugger", "SKILL.md"), "# Debugger\n");
  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts", "base.yaml"),
    yaml.stringify({ name: "base", include })
  );

  return { projectRoot, loadoutRoot };
}

function readBaseLoadout(loadoutRoot: string): { include: unknown[] } {
  return yaml.parse(
    fs.readFileSync(path.join(loadoutRoot, "loadouts", "base.yaml"), "utf-8")
  );
}

describe("loadout assembly commands", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("normalizes artifact paths relative to .loadouts", () => {
    const { loadoutRoot } = setupProject();

    expect(normalizeIncludePath("rules/api.md", loadoutRoot)).toBe("rules/api.md");
    expect(normalizeIncludePath(".loadouts/rules/api.md", loadoutRoot)).toBe("rules/api.md");
    expect(normalizeIncludePath(path.join(loadoutRoot, "rules", "api.md"), loadoutRoot)).toBe("rules/api.md");
    expect(() => normalizeIncludePath("../outside.md", loadoutRoot)).toThrow("cannot escape");
  });

  it("adds existing artifacts and skips duplicates", async () => {
    const { projectRoot, loadoutRoot } = setupProject(["rules/api.md"]);

    const result = await runAddTo(
      "base",
      ["rules/api.md", "skills/debugger"],
      { local: true },
      projectRoot
    );

    expect(result.changed).toEqual(["skills/debugger"]);
    expect(result.skipped).toEqual([{ path: "rules/api.md", reason: "already included" }]);
    expect(readBaseLoadout(loadoutRoot).include).toEqual(["rules/api.md", "skills/debugger"]);
  });

  it("adds object includes when tools are specified", async () => {
    const { projectRoot, loadoutRoot } = setupProject();

    const result = await runAddTo(
      "base",
      ["rules/api.md"],
      { local: true, tools: "cursor,opencode" },
      projectRoot
    );

    expect(result.changed).toEqual(["rules/api.md"]);
    expect(readBaseLoadout(loadoutRoot).include).toEqual([
      { path: "rules/api.md", tools: ["cursor", "opencode"] },
    ]);
  });

  it("skips existing includes instead of replacing tool targeting", async () => {
    const { projectRoot, loadoutRoot } = setupProject(["rules/api.md"]);

    const result = await runAddTo(
      "base",
      ["rules/api.md"],
      { local: true, tools: "cursor" },
      projectRoot
    );

    expect(result.changed).toEqual([]);
    expect(result.skipped).toEqual([{ path: "rules/api.md", reason: "already included" }]);
    expect(readBaseLoadout(loadoutRoot).include).toEqual(["rules/api.md"]);
  });

  it("rejects invalid tool options and conflicting scope flags", async () => {
    const { projectRoot } = setupProject();

    expect(() => parseToolsOption(",")).toThrow("--tools requires at least one tool name.");
    expect(() => parseToolsOption("missing-tool")).toThrow("Unknown tool: missing-tool");
    await expect(
      runAddTo("base", ["rules/api.md"], { local: true, global: true }, projectRoot)
    ).rejects.toThrow("Use either --local or --global, not both.");
  });

  it("removes string and object includes by path without deleting artifacts", async () => {
    const { projectRoot, loadoutRoot } = setupProject([
      "rules/api.md",
      { path: "skills/debugger", tools: ["opencode"] },
    ]);

    const result = await runRemoveFrom(
      "base",
      ["rules/api.md", "skills/debugger", "rules/missing.md"],
      { local: true },
      projectRoot
    );

    expect(result.changed).toEqual(["rules/api.md", "skills/debugger"]);
    expect(result.skipped).toEqual([{ path: "rules/missing.md", reason: "not included" }]);
    expect(readBaseLoadout(loadoutRoot).include).toEqual([]);
    expect(fs.existsSync(path.join(loadoutRoot, "rules", "api.md"))).toBe(true);
    expect(fs.existsSync(path.join(loadoutRoot, "skills", "debugger", "SKILL.md"))).toBe(true);
  });

  it("rejects missing artifacts without changing the loadout", async () => {
    const { projectRoot, loadoutRoot } = setupProject();

    await expect(
      runAddTo("base", ["rules/missing.md"], { local: true }, projectRoot)
    ).rejects.toThrow("Artifact not found: rules/missing.md");

    expect(readBaseLoadout(loadoutRoot).include).toEqual([]);
  });
});
