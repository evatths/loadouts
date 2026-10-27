import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { resolveContexts } from "../../core/scope.js";
import { applyMultiPlan, planRender } from "../../core/render.js";
import { loadResolvedLoadouts } from "../../core/resolve.js";
import { getStatusJson, loadStatusGroupsForContext } from "./status.js";

let tempDir: string | undefined;

function setupProject(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-status-json-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutRoot = path.join(projectRoot, ".loadouts");
  fs.mkdirSync(path.join(loadoutRoot, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "rules"), { recursive: true });
  fs.writeFileSync(path.join(loadoutRoot, "loadouts.yaml"), yaml.stringify({ version: "1" }));
  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts", "base.yaml"),
    yaml.stringify({ name: "base", include: ["rules/base.md"] })
  );
  fs.writeFileSync(path.join(loadoutRoot, "rules", "base.md"), "# Base rule\n", "utf-8");
  fs.writeFileSync(
    path.join(loadoutRoot, ".state.json"),
    JSON.stringify({ active: ["base"], mode: "symlink", appliedAt: new Date().toISOString(), entries: [] }),
    "utf-8"
  );
  return projectRoot;
}

describe("status --json", () => {
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

  it("returns parseable JSON with active and drift keys", async () => {
    const projectRoot = setupProject();
    const { contexts } = await resolveContexts({ local: true }, projectRoot);
    const payload = await getStatusJson(contexts, projectRoot);
    const parsed = JSON.parse(JSON.stringify(payload));

    expect(Array.isArray(parsed.active)).toBe(true);
    expect(Array.isArray(parsed.drift)).toBe(true);
    expect(parsed.active).toContain("base");
    expect(parsed.drift[0]).toMatchObject({ name: "base" });
    expect(parsed.drift[0]).toHaveProperty("kind");
    expect(parsed.drift[0]).toHaveProperty("path");
    expect(parsed.drift[0]).toHaveProperty("reason");
  });
});

describe("status with composed instructions", () => {
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

  it("shows each composed instruction as ok and in sync", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-status-composed-"));
    const projectRoot = path.join(tempDir, "project");
    const loadoutRoot = path.join(projectRoot, ".loadouts");
    fs.mkdirSync(path.join(loadoutRoot, "loadouts"), { recursive: true });
    fs.mkdirSync(path.join(loadoutRoot, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(loadoutRoot, "loadouts.yaml"), yaml.stringify({ version: "1" }));
    for (const name of ["one", "two"]) {
      fs.writeFileSync(
        path.join(loadoutRoot, "loadouts", `${name}.yaml`),
        yaml.stringify({ name, tools: ["opencode"], include: [`instructions/AGENTS.${name}.md`] })
      );
      fs.writeFileSync(path.join(loadoutRoot, "instructions", `AGENTS.${name}.md`), `# ${name}\n`);
    }

    const { contexts } = await resolveContexts({ local: true }, projectRoot);
    const ctx = contexts[0];
    const { loadouts } = await loadResolvedLoadouts(ctx, ["one", "two"], { includeBundled: true });
    const plans = [];
    for (const loadout of loadouts) {
      plans.push({ loadout, plan: await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath) });
    }
    await applyMultiPlan(plans, ctx.configPath, ctx.projectRoot, "symlink", ctx.scope);

    const groups = await loadStatusGroupsForContext(ctx, false);
    expect(groups.map((g) => g.loadoutName).sort()).toEqual(["one", "two"]);
    for (const group of groups) {
      expect(group.artifacts.length).toBeGreaterThan(0);
      expect(group.artifacts.every((a) => a.overallStatus === "ok")).toBe(true);
      expect(group.config).toEqual({ added: [], removed: [] });
      expect(group.inSync).toBe(true);
    }
  });
});
