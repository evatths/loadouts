import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { runRuntime, runtimeSystemBlock } from "./runtime.js";

let tempDir: string | undefined;

function setupProject(): { projectRoot: string; loadoutRoot: string } {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-runtime-cli-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutRoot = path.join(projectRoot, ".loadouts");
  const sharedRoot = path.join(tempDir, "shared", ".loadouts");

  fs.mkdirSync(path.join(loadoutRoot, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "rules"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "skills", "debug"), { recursive: true });
  fs.mkdirSync(path.join(sharedRoot, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(sharedRoot, "rules"), { recursive: true });

  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts.yaml"),
    yaml.stringify({ version: "1", default: "base", sources: ["../shared"] })
  );
  fs.writeFileSync(path.join(loadoutRoot, "AGENTS.md"), "# Project instructions\n", "utf-8");

  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts", "base.yaml"),
    yaml.stringify({ name: "base", include: ["rules/base.md"] })
  );
  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts", "extra.yaml"),
    yaml.stringify({ name: "extra", include: ["skills/debug"] })
  );
  fs.writeFileSync(path.join(loadoutRoot, "rules", "base.md"), "# Base rule\n", "utf-8");
  fs.writeFileSync(path.join(loadoutRoot, "skills", "debug", "SKILL.md"), "# Debug skill\n", "utf-8");

  fs.writeFileSync(
    path.join(sharedRoot, "loadouts.yaml"),
    yaml.stringify({ version: "1", default: "shared" })
  );
  fs.writeFileSync(
    path.join(sharedRoot, "loadouts", "shared.yaml"),
    yaml.stringify({ name: "shared", include: ["rules/shared.md"] })
  );
  fs.writeFileSync(path.join(sharedRoot, "rules", "shared.md"), "# Shared rule\n", "utf-8");

  fs.writeFileSync(
    path.join(loadoutRoot, ".state.json"),
    JSON.stringify({ active: ["base"], entries: [{ targetPath: "AGENTS.md" }] }, null, 2),
    "utf-8"
  );

  return { projectRoot, loadoutRoot };
}

describe("runtime command compile surface", () => {
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

  it("uses root default loadout and returns runtime JSON shape", async () => {
    const { projectRoot } = setupProject();

    const result = await runRuntime([], { local: true, json: true }, projectRoot);

    expect(result.bundle.schemaVersion).toBe(1);
    expect(result.bundle.tool).toBe("opencode");
    expect(result.bundle.loadouts.map((l) => l.name)).toEqual(["base"]);
    expect(result.bundle.fingerprint.length).toBeGreaterThan(0);
    expect(result.bundle.generatedAt.length).toBeGreaterThan(0);
  });

  it("resolves multiple loadouts including source-defined names", async () => {
    const { projectRoot } = setupProject();

    const result = await runRuntime(["base", "shared"], { local: true }, projectRoot);

    expect(result.loadoutNames).toEqual(["base", "shared"]);
    expect(result.bundle.loadouts.map((l) => l.name)).toEqual(["base", "shared"]);
    expect(result.bundle.components.some((c) => c.relativePath === "rules/shared.md")).toBe(true);
  });

  it("does not mutate state or render outputs", async () => {
    const { projectRoot, loadoutRoot } = setupProject();
    const statePath = path.join(loadoutRoot, ".state.json");
    const beforeState = fs.readFileSync(statePath, "utf-8");

    await runRuntime(["base", "extra"], { local: true }, projectRoot);

    const afterState = fs.readFileSync(statePath, "utf-8");
    expect(afterState).toBe(beforeState);
    expect(fs.existsSync(path.join(projectRoot, ".opencode"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("fails for unknown tool", async () => {
    const { projectRoot } = setupProject();
    await expect(
      runRuntime(["base"], { local: true, tool: "missing-tool" }, projectRoot)
    ).rejects.toThrow("Unknown tool: missing-tool");
  });

  it("renders system block output from exported helper", async () => {
    const { projectRoot } = setupProject();
    const result = await runRuntime(["base"], { local: true }, projectRoot);

    const block = runtimeSystemBlock(result.bundle);
    expect(block).toContain("[loadout-runtime:v1]");
    expect(block).toContain("tool: opencode");
    expect(block).toContain("## Instructions (Model Injection Ready)");
  });
});
