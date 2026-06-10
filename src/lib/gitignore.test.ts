import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  updateTargetGitignore,
  updateLoadoutsGitignore,
  getManagedPathsFromTarget,
  computeArtifactGitignorePaths,
  rebuildAllGitignores,
  inspectGitignoreHealth,
  hasLegacyRootGitignoreSection,
  removeLegacyRootGitignoreSection,
  getManagedPaths,
} from "./gitignore.js";
import { registry } from "../core/registry.js";
import { createPluginAPI } from "../core/plugin.js";
import { registerBuiltins } from "../builtins/index.js";

// Register built-in kinds and tools for tests
registerBuiltins(createPluginAPI(registry));

describe("gitignore", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-gitignore-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // updateTargetGitignore
  // ---------------------------------------------------------------------------

  describe("updateTargetGitignore", () => {
    it("creates .gitignore in target directory", () => {
      const targetDir = path.join(tmpDir, ".claude");
      updateTargetGitignore(targetDir, ["rules/my-rule.md"]);

      const content = fs.readFileSync(
        path.join(targetDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("# <loadouts>");
      expect(content).toContain("rules/my-rule.md");
      expect(content).toContain("# </loadouts>");
    });

    it("creates parent directories if they don't exist", () => {
      const targetDir = path.join(tmpDir, "nested", ".claude");
      updateTargetGitignore(targetDir, ["rules/foo.md"]);

      expect(
        fs.existsSync(path.join(targetDir, ".gitignore"))
      ).toBe(true);
    });

    it("handles dir-layout paths with trailing slashes", () => {
      const targetDir = path.join(tmpDir, ".claude");
      updateTargetGitignore(targetDir, ["skills/my-skill/"]);

      const paths = getManagedPathsFromTarget(targetDir);
      expect(paths).toContain("skills/my-skill/");
    });

    it("deduplicates paths", () => {
      const targetDir = path.join(tmpDir, ".claude");
      updateTargetGitignore(targetDir, [
        "skills/a/",
        "skills/a/",
        "skills/b/",
      ]);

      const paths = getManagedPathsFromTarget(targetDir);
      expect(paths.filter((p) => p === "skills/a/")).toHaveLength(1);
      expect(paths).toContain("skills/b/");
    });

    it("preserves user content outside markers", () => {
      const targetDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, ".gitignore"),
        "*.log\n"
      );

      updateTargetGitignore(targetDir, ["rules/test.md"]);

      const content = fs.readFileSync(
        path.join(targetDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("*.log");
      expect(content).toContain("rules/test.md");
    });

    it("updates existing managed section without duplicating", () => {
      const targetDir = path.join(tmpDir, ".claude");
      updateTargetGitignore(targetDir, ["rules/a.md"]);
      updateTargetGitignore(targetDir, ["rules/b.md"]);

      const content = fs.readFileSync(
        path.join(targetDir, ".gitignore"),
        "utf-8"
      );
      const matches = content.match(/# <loadouts>/g);
      expect(matches).toHaveLength(1);
      expect(content).not.toContain("rules/a.md");
      expect(content).toContain("rules/b.md");
    });

    it("removes managed section when paths array is empty", () => {
      const targetDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, ".gitignore"),
        "*.log\n"
      );
      updateTargetGitignore(targetDir, ["rules/a.md"]);
      updateTargetGitignore(targetDir, []);

      const content = fs.readFileSync(
        path.join(targetDir, ".gitignore"),
        "utf-8"
      );
      expect(content).not.toContain("# <loadouts>");
      expect(content).toContain("*.log");
    });
  });

  // ---------------------------------------------------------------------------
  // updateLoadoutsGitignore
  // ---------------------------------------------------------------------------

  describe("updateLoadoutsGitignore", () => {
    it("creates .loadouts/.gitignore with state file entries", () => {
      updateLoadoutsGitignore(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain(".state.json");
      expect(content).toContain(".fallback-applied");
    });

    it("creates .gitignore if missing", () => {
      updateLoadoutsGitignore(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, ".gitignore"))).toBe(true);
    });

    it("uses relative paths (no leading directory component)", () => {
      updateLoadoutsGitignore(tmpDir);
      const paths = getManagedPathsFromTarget(tmpDir);
      expect(paths.every((p) => !p.includes("/"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // getManagedPathsFromTarget
  // ---------------------------------------------------------------------------

  describe("getManagedPathsFromTarget", () => {
    it("returns empty array when no .gitignore", () => {
      expect(getManagedPathsFromTarget(tmpDir)).toEqual([]);
    });

    it("returns empty array when no managed section", () => {
      const targetDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, ".gitignore"), "*.log\n");
      expect(getManagedPathsFromTarget(targetDir)).toEqual([]);
    });

    it("extracts paths from managed section", () => {
      const targetDir = path.join(tmpDir, ".claude");
      updateTargetGitignore(targetDir, [
        "rules/foo.md",
        "skills/bar/",
      ]);

      const paths = getManagedPathsFromTarget(targetDir);
      expect(paths).toContain("rules/foo.md");
      expect(paths).toContain("skills/bar/");
    });
  });

  // ---------------------------------------------------------------------------
  // computeArtifactGitignorePaths
  // ---------------------------------------------------------------------------

  describe("computeArtifactGitignorePaths", () => {
    it("returns a Map grouped by target base path", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "project");
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBeGreaterThan(0);
    });

    it("uses relative base paths for project scope", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "project");
      for (const key of result.keys()) {
        expect(path.isAbsolute(key)).toBe(false);
      }
    });

    it("uses absolute base paths for global scope", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "global");
      for (const key of result.keys()) {
        expect(path.isAbsolute(key)).toBe(true);
      }
    });

    it("returns paths relative to the target directory (no target prefix)", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "project");
      for (const paths of result.values()) {
        for (const p of paths) {
          // Should not start with the tool directory name (e.g., .claude/)
          expect(p).not.toMatch(/^\./);
        }
      }
    });

    it("includes rule paths without trailing slash", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "project");
      for (const paths of result.values()) {
        for (const p of paths) {
          expect(p.endsWith("/")).toBe(false);
        }
      }
    });

    it("includes skill paths with trailing slash", () => {
      const result = computeArtifactGitignorePaths("skill", "my-skill", "project");
      for (const paths of result.values()) {
        for (const p of paths) {
          expect(p.endsWith("/")).toBe(true);
        }
      }
    });

    it("includes entries for claude-code, cursor, and opencode for rules", () => {
      const result = computeArtifactGitignorePaths("rule", "my-rule", "project");
      const allPaths = [...result.entries()].flatMap(([base, paths]) =>
        paths.map((p) => path.join(base, p))
      );
      expect(allPaths.some((p) => p.includes(".claude"))).toBe(true);
      expect(allPaths.some((p) => p.includes(".cursor"))).toBe(true);
      expect(allPaths.some((p) => p.includes(".opencode"))).toBe(true);
    });

    it("includes instruction artifacts in the root gitignore target", () => {
      const result = computeArtifactGitignorePaths("instruction", "AGENTS.base", "project");
      expect(result.get(".")).toContain("AGENTS.md");
      expect(result.get(".")).toContain("CLAUDE.md");
    });

    it("includes OpenCode plugins under the OpenCode target directory", () => {
      const result = computeArtifactGitignorePaths("opencode-plugin", "notify.ts", "project");
      expect(result.get(".opencode")).toEqual(["plugins/notify.ts"]);
    });

    it("includes OpenCode config in the root gitignore target", () => {
      const result = computeArtifactGitignorePaths("opencode-config", "opencode.jsonc", "project");
      expect(result.get(".")).toEqual(["opencode.jsonc"]);
    });

    it("includes OpenCode commands under the OpenCode target directory", () => {
      const result = computeArtifactGitignorePaths("opencode-command", "loadouts", "project");
      expect(result.get(".opencode")).toEqual(["commands/loadouts.md"]);
    });

    it("returns empty map for unknown kind", () => {
      const result = computeArtifactGitignorePaths("unknown-kind", "test", "project");
      expect(result.size).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // rebuildAllGitignores
  // ---------------------------------------------------------------------------

  describe("rebuildAllGitignores", () => {
    let loadoutsDir: string;

    beforeEach(() => {
      loadoutsDir = path.join(tmpDir, ".loadouts");
      fs.mkdirSync(path.join(loadoutsDir, "rules"), { recursive: true });
      fs.mkdirSync(path.join(loadoutsDir, "skills"), { recursive: true });
    });

    it("writes per-target .gitignore files for all rules", () => {
      fs.writeFileSync(
        path.join(loadoutsDir, "rules", "my-rule.md"),
        "---\n---\n# Rule\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      // Should write .claude/.gitignore
      const claudePaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".claude")
      );
      expect(claudePaths).toContain("rules/my-rule.md");
    });

    it("writes per-target .gitignore files for all skills", () => {
      fs.mkdirSync(path.join(loadoutsDir, "skills", "my-skill"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(loadoutsDir, "skills", "my-skill", "SKILL.md"),
        "---\nname: my-skill\n---\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const claudePaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".claude")
      );
      expect(claudePaths).toContain("skills/my-skill/");
    });

    it("handles multiple artifacts across rules and skills", () => {
      fs.writeFileSync(
        path.join(loadoutsDir, "rules", "rule-a.md"),
        "# Rule A\n"
      );
      fs.writeFileSync(
        path.join(loadoutsDir, "rules", "rule-b.md"),
        "# Rule B\n"
      );
      fs.mkdirSync(path.join(loadoutsDir, "skills", "skill-x"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(loadoutsDir, "skills", "skill-x", "SKILL.md"),
        "---\nname: skill-x\n---\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const claudePaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".claude")
      );
      expect(claudePaths).toContain("rules/rule-a.md");
      expect(claudePaths).toContain("rules/rule-b.md");
      expect(claudePaths).toContain("skills/skill-x/");
    });

    it("handles empty loadouts directory without error", () => {
      expect(() =>
        rebuildAllGitignores(loadoutsDir, tmpDir, "project")
      ).not.toThrow();
    });

    it("each target gets only its own relative paths (no cross-contamination)", () => {
      fs.writeFileSync(
        path.join(loadoutsDir, "rules", "my-rule.md"),
        "# Rule\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const claudePaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".claude")
      );
      const cursorPaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".cursor")
      );

      // Neither should contain the other tool's directory prefix
      for (const p of claudePaths) {
        expect(p).not.toContain(".cursor");
      }
      for (const p of cursorPaths) {
        expect(p).not.toContain(".claude");
      }
    });

    it("removes stale managed sections when no artifacts remain", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, ".gitignore"),
        `*.log\n\n# <loadouts>\n# Auto-generated by loadouts.\nrules/old-rule.md\n# </loadouts>\n`
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const content = fs.readFileSync(path.join(claudeDir, ".gitignore"), "utf-8");
      expect(content).toContain("*.log");
      expect(content).not.toContain("# <loadouts>");
      expect(getManagedPathsFromTarget(claudeDir)).toEqual([]);
    });

    it("writes root .gitignore entries for root-level artifacts", () => {
      fs.mkdirSync(path.join(loadoutsDir, "instructions"), { recursive: true });
      fs.mkdirSync(path.join(loadoutsDir, "opencode"), { recursive: true });
      fs.writeFileSync(
        path.join(loadoutsDir, "instructions", "AGENTS.base.md"),
        "# Instructions\n"
      );
      fs.writeFileSync(
        path.join(loadoutsDir, "opencode", "opencode.jsonc"),
        "{}\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const rootPaths = getManagedPathsFromTarget(tmpDir);
      expect(rootPaths).toContain("AGENTS.md");
      expect(rootPaths).toContain("CLAUDE.md");
      expect(rootPaths).toContain("opencode.jsonc");
    });

    it("writes OpenCode plugin entries to .opencode/.gitignore", () => {
      fs.mkdirSync(path.join(loadoutsDir, "opencode", "plugins"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(loadoutsDir, "opencode", "plugins", "notify.ts"),
        "export const Notify = async () => ({})\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const opencodePaths = getManagedPathsFromTarget(
        path.join(tmpDir, ".opencode")
      );
      expect(opencodePaths).toContain("plugins/notify.ts");
    });

    it("writes Pi extension and theme entries to .pi/.gitignore", () => {
      fs.mkdirSync(path.join(loadoutsDir, "extensions"), { recursive: true });
      fs.mkdirSync(path.join(loadoutsDir, "themes"), { recursive: true });
      fs.writeFileSync(
        path.join(loadoutsDir, "extensions", "tmux.ts"),
        "export default {}\n"
      );
      fs.writeFileSync(
        path.join(loadoutsDir, "themes", "dark.json"),
        "{}\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const piPaths = getManagedPathsFromTarget(path.join(tmpDir, ".pi"));
      expect(piPaths).toContain("extensions/tmux.ts");
      expect(piPaths).toContain("themes/dark.json");
    });

    it("replaces old root managed sections with current root artifact entries", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadout>\n.claude/rules/old.md\n# </loadout>\n`
      );
      fs.mkdirSync(path.join(loadoutsDir, "opencode"), { recursive: true });
      fs.writeFileSync(
        path.join(loadoutsDir, "opencode", "opencode.jsonc"),
        "{}\n"
      );

      rebuildAllGitignores(loadoutsDir, tmpDir, "project");

      const content = fs.readFileSync(path.join(tmpDir, ".gitignore"), "utf-8");
      expect(content).toContain("node_modules/");
      expect(content).toContain("# <loadouts>");
      expect(content).toContain("opencode.jsonc");
      expect(content).not.toContain("# <loadout>");
      expect(content).not.toContain(".claude/rules/old.md");
    });
  });

  // ---------------------------------------------------------------------------
  // inspectGitignoreHealth
  // ---------------------------------------------------------------------------

  describe("inspectGitignoreHealth", () => {
    it("detects missing state and target managed sections", () => {
      const loadoutsDir = path.join(tmpDir, ".loadouts");
      fs.mkdirSync(path.join(loadoutsDir, "rules"), { recursive: true });
      fs.mkdirSync(path.join(loadoutsDir, "skills"), { recursive: true });
      fs.writeFileSync(path.join(loadoutsDir, "rules", "my-rule.md"), "# Rule\n");

      const report = inspectGitignoreHealth(loadoutsDir, tmpDir, "project");

      expect(report.loadoutsStateOutOfDate).toBe(true);
      expect(report.targetMismatches.length).toBeGreaterThan(0);
      expect(
        report.targetMismatches.some((m) =>
          m.expectedPaths.includes("rules/my-rule.md") && m.actualPaths.length === 0
        )
      ).toBe(true);
      expect(report.issues).toBeGreaterThan(0);
    });

    it("detects stale managed entries in target gitignore", () => {
      const loadoutsDir = path.join(tmpDir, ".loadouts");
      fs.mkdirSync(path.join(loadoutsDir, "rules"), { recursive: true });
      fs.mkdirSync(path.join(loadoutsDir, "skills"), { recursive: true });

      const cursorDir = path.join(tmpDir, ".cursor");
      fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, ".gitignore"),
        `# <loadouts>\n# Auto-generated by loadouts.\nrules/old-rule.mdc\n# </loadouts>\n`
      );

      const report = inspectGitignoreHealth(loadoutsDir, tmpDir, "project");
      const cursorMismatch = report.targetMismatches.find(
        (m) => m.targetDir === cursorDir
      );

      expect(cursorMismatch).toBeDefined();
      expect(cursorMismatch?.expectedPaths).toEqual([]);
      expect(cursorMismatch?.actualPaths).toEqual(["rules/old-rule.mdc"]);
    });
  });

  // ---------------------------------------------------------------------------
  // hasLegacyRootGitignoreSection
  // ---------------------------------------------------------------------------

  describe("hasLegacyRootGitignoreSection", () => {
    it("detects current marker sections", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadouts>\nfoo\n# </loadouts>\n`
      );
      expect(hasLegacyRootGitignoreSection(tmpDir)).toBe(true);
    });

    it("detects old marker sections", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadout>\nfoo\n# </loadout>\n`
      );
      expect(hasLegacyRootGitignoreSection(tmpDir)).toBe(true);
    });

    it("returns false when no managed section exists", () => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      expect(hasLegacyRootGitignoreSection(tmpDir)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // removeLegacyRootGitignoreSection
  // ---------------------------------------------------------------------------

  describe("removeLegacyRootGitignoreSection", () => {
    it("removes # <loadouts> section from root .gitignore", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadouts>\n# Auto-generated by loadouts.\n.claude/rules/foo.md\n# </loadouts>\n`
      );

      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("node_modules/");
      expect(content).not.toContain("# <loadouts>");
      expect(content).not.toContain(".claude/rules/foo.md");
    });

    it("removes # <loadout> (old marker) section from root .gitignore", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadout>\n# Auto-generated.\n.cursor/rules/bar.mdc\n# </loadout>\n`
      );

      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("node_modules/");
      expect(content).not.toContain("# <loadout>");
      expect(content).not.toContain(".cursor/rules/bar.mdc");
    });

    it("removes both old and new marker sections", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadout>\nold-path\n# </loadout>\n\n# <loadouts>\nnew-path\n# </loadouts>\n`
      );

      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("node_modules/");
      expect(content).not.toContain("old-path");
      expect(content).not.toContain("new-path");
    });

    it("preserves all user content outside markers", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `*.log\ndist/\n\n# <loadouts>\n.claude/rules/foo.md\n# </loadouts>\n\nbuild/\n`
      );

      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content).toContain("*.log");
      expect(content).toContain("dist/");
      expect(content).toContain("build/");
    });

    it("does nothing when .gitignore has no managed section", () => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");

      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content.trim()).toBe("node_modules/");
    });

    it("does nothing when .gitignore does not exist", () => {
      expect(() =>
        removeLegacyRootGitignoreSection(tmpDir)
      ).not.toThrow();
    });

    it("is idempotent — safe to run multiple times", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `node_modules/\n\n# <loadouts>\n.claude/rules/foo.md\n# </loadouts>\n`
      );

      removeLegacyRootGitignoreSection(tmpDir);
      removeLegacyRootGitignoreSection(tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, ".gitignore"),
        "utf-8"
      );
      expect(content.trim()).toBe("node_modules/");
    });
  });

  // ---------------------------------------------------------------------------
  // getManagedPaths (deprecated — migration detection)
  // ---------------------------------------------------------------------------

  describe("getManagedPaths (deprecated)", () => {
    it("returns empty array when no .gitignore", () => {
      expect(getManagedPaths(tmpDir)).toEqual([]);
    });

    it("returns empty array when no managed section", () => {
      fs.writeFileSync(path.join(tmpDir, ".gitignore"), "node_modules/\n");
      expect(getManagedPaths(tmpDir)).toEqual([]);
    });

    it("detects legacy managed section in root .gitignore", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".gitignore"),
        `# <loadouts>\n# Auto-generated by loadouts.\n.claude/rules/foo.md\n# </loadouts>\n`
      );
      const paths = getManagedPaths(tmpDir);
      expect(paths).toContain(".claude/rules/foo.md");
    });
  });
});
