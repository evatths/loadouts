import { describe, it, expect, beforeAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { runInstall } from "./install.js";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import type { CommandContext } from "../../core/types.js";

let tempDir: string | undefined;

function setupProject(): { projectRoot: string; loadoutPath: string; ctx: CommandContext } {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-install-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutPath = path.join(projectRoot, ".loadouts");

  fs.mkdirSync(path.join(loadoutPath, "loadouts"), { recursive: true });
  fs.writeFileSync(
    path.join(loadoutPath, "loadouts", "base.yaml"),
    yaml.stringify({ name: "base", include: [] })
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

function cleanup(): void {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
}

describe("runInstall source path", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("imports canonical source layouts into the target loadout", async () => {
    const { loadoutPath, ctx } = setupProject();
    const sourcePath = path.join(tempDir!, "package");
    fs.mkdirSync(path.join(sourcePath, "rules"), { recursive: true });
    fs.mkdirSync(path.join(sourcePath, "skills", "debug"), { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "rules", "review.mdc"),
      "---\nglobs:\n  - '**/*.ts'\n---\n# Review\n"
    );
    fs.writeFileSync(
      path.join(sourcePath, "skills", "debug", "SKILL.md"),
      "---\ndescription: Debug failures\ndisable-model-invocation: true\n---\n# Debug\n"
    );

    const result = await runInstall(ctx, {
      source: sourcePath,
      yes: true,
      keep: true,
      to: "base",
    });

    expect(result).toEqual({ imported: 2, skipped: 0, failed: 0 });
    expect(fs.existsSync(path.join(loadoutPath, "rules", "review.md"))).toBe(true);
    expect(fs.existsSync(path.join(loadoutPath, "skills", "debug", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(sourcePath, "rules", "review.mdc"))).toBe(true);

    const rule = fs.readFileSync(path.join(loadoutPath, "rules", "review.md"), "utf-8");
    expect(rule).toContain("paths:");
    expect(rule).not.toContain("globs:");

    const skill = fs.readFileSync(path.join(loadoutPath, "skills", "debug", "SKILL.md"), "utf-8");
    expect(skill).toContain("model-invocable: false");
    expect(skill).not.toContain("disable-model-invocation");

    const loadout = yaml.parse(
      fs.readFileSync(path.join(loadoutPath, "loadouts", "base.yaml"), "utf-8")
    );
    expect(loadout.include.sort()).toEqual(["rules/review.md", "skills/debug"]);
  });

  it("previews source installs without writing files", async () => {
    const { loadoutPath, ctx } = setupProject();
    const sourcePath = path.join(tempDir!, "downloaded-rule.md");
    fs.writeFileSync(sourcePath, "# Downloaded\n");

    const result = await runInstall(ctx, {
      source: sourcePath,
      yes: true,
      dryRun: true,
      to: "base",
    });

    expect(result).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(fs.existsSync(path.join(loadoutPath, "rules", "downloaded-rule.md"))).toBe(false);

    const loadout = yaml.parse(
      fs.readFileSync(path.join(loadoutPath, "loadouts", "base.yaml"), "utf-8")
    );
    expect(loadout.include).toEqual([]);
  });

  it("imports registry-mapped artifacts from a source file", async () => {
    const { loadoutPath, ctx } = setupProject();
    const sourcePath = path.join(tempDir!, "export", ".opencode", "plugins", "notify.ts");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "export default {};\n");

    const result = await runInstall(ctx, {
      source: sourcePath,
      kinds: "opencode-plugin",
      yes: true,
      keep: true,
      to: "base",
    });

    expect(result).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(fs.existsSync(path.join(loadoutPath, "opencode", "plugins", "notify.ts"))).toBe(true);

    const loadout = yaml.parse(
      fs.readFileSync(path.join(loadoutPath, "loadouts", "base.yaml"), "utf-8")
    );
    expect(loadout.include).toEqual(["opencode/plugins/notify.ts"]);
  });

  it("refuses to import from the target .loadouts directory", async () => {
    const { loadoutPath, ctx } = setupProject();
    const sourcePath = path.join(loadoutPath, "rules", "existing.md");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "# Existing\n");

    await expect(runInstall(ctx, { source: sourcePath, yes: true })).rejects.toThrow(
      "Refusing to import from the target .loadouts directory."
    );
  });
});
