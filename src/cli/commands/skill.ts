/**
 * loadout skill — Manage skills.
 *
 * Scope flags:
 *   -l / --local   → project scope
 *   -g / --global  → global scope
 *   (none)         → project if in one, else global
 */

import { Command } from "commander";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import * as yaml from "yaml";
import {
  findNearestLoadoutRoot,
  getProjectRoot,
  getGlobalConfigPath,
} from "../../core/discovery.js";
import {
  writeFile,
  readFile,
  fileExists,
  isDirectory,
  ensureDir,
  removeDir,
  copyDir,
  listFiles,
} from "../../lib/fs.js";
import {
  parseLoadoutDefinition,
  parseSkillFrontmatter,
  sanitizeSkillFile,
  sanitizeSkillFrontmatter,
  serializeFrontmatter,
} from "../../core/config.js";
import { inProject, hasGlobal } from "../../core/scope.js";
import { log, heading } from "../../lib/output.js";
import { openInEditor } from "../../lib/editor.js";
import { rebuildAllGitignores } from "../../lib/gitignore.js";
import * as os from "node:os";
import type { Scope } from "../../core/types.js";

const SKILLS_DIR = "skills";

interface SkillScopeOptions {
  local?: boolean;
  global?: boolean;
  noEdit?: boolean;
}

/**
 * Resolve the loadout root path based on scope flags.
 */
async function resolveRootPath(
  options: SkillScopeOptions,
  cwd: string = process.cwd()
): Promise<{ rootPath: string; scope: Scope }> {
  if (options.local) {
    const projectRoot = await findNearestLoadoutRoot(cwd);
    if (!projectRoot) {
      throw new Error("Not in a loadout project. Run 'loadouts init' first.");
    }
    return { rootPath: projectRoot.path, scope: "project" };
  }

  if (options.global) {
    if (!hasGlobal()) {
      throw new Error("No global loadout found. Run 'loadouts init --global' first.");
    }
    return { rootPath: getGlobalConfigPath(), scope: "global" };
  }

  // Auto-detect: prefer project if in one
  if (await inProject(cwd)) {
    const projectRoot = await findNearestLoadoutRoot(cwd);
    return { rootPath: projectRoot!.path, scope: "project" };
  }

  if (hasGlobal()) {
    return { rootPath: getGlobalConfigPath(), scope: "global" };
  }

  throw new Error("No loadout found. Run 'loadouts init' or 'loadouts init --global' first.");
}

export const skillCommand = new Command("skill").description("Manage skills");

// loadout skill add <name>
skillCommand
  .command("add")
  .description("Create a new skill")
  .argument("<name>", "Skill name")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .option("-d, --description <desc>", "Skill description")
  .option("--no-edit", "Don't open in editor after creating")
  .action(async (name, options) => {
    let rootPath: string;
    let scope: Scope;

    try {
      ({ rootPath, scope } = await resolveRootPath(options));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const skillPath = path.join(rootPath, SKILLS_DIR, name);
    const skillMdPath = path.join(skillPath, "SKILL.md");

    if (isDirectory(skillPath)) {
      log.error(`Skill '${name}' already exists in ${scope} scope.`);
      process.exit(1);
    }

    // Create skill directory structure
    ensureDir(skillPath);
    ensureDir(path.join(skillPath, "references"));

    const frontmatter = sanitizeSkillFrontmatter(
      {
        name,
        description: options.description,
      },
      name
    );

    const content = serializeFrontmatter(frontmatter, `

# ${name}

## Overview

Describe what this skill does and when to use it.

## Instructions

Provide specific instructions for the AI agent.

## Examples

Include examples if helpful.
`);

    writeFile(skillMdPath, content);

    // Rebuild per-target .gitignore files for all existing artifacts
    const projectRoot = scope === "project" ? path.dirname(rootPath) : os.homedir();
    rebuildAllGitignores(rootPath, projectRoot, scope);

    const scopeLabel = scope === "global" ? "global" : "project";
    log.success(`Created ${scopeLabel} skill: ${name}`);

    // Open in editor unless --no-edit (Commander sets options.edit = false for --no-edit)
    if (options.edit !== false) {
      log.dim(`  ${skillPath}/`);
      await openInEditor(skillMdPath, { cwd: rootPath });
      if (sanitizeSkillFile(skillMdPath)) {
        log.dim("  Canonicalized skill frontmatter");
      }
    } else {
      // For agents/scripts: show clear path and instructions
      console.log();
      console.log(`  File: ${skillMdPath}`);
      console.log();
      log.dim("  Replace the template content with your skill, then run 'loadouts sync'");
    }
  });

// loadout skill list
skillCommand
  .command("list")
  .description("List skills")
  .option("-l, --local", "Project scope only")
  .option("-g, --global", "Global scope only")
  .option("-a, --all", "Both scopes")
  .action(async (options) => {
    const cwd = process.cwd();
    const roots: Array<{ rootPath: string; scope: Scope }> = [];

    // Determine which scopes to list
    if (options.all || (!options.local && !options.global)) {
      // Show all available
      if (await inProject(cwd)) {
        const projectRoot = await findNearestLoadoutRoot(cwd);
        if (projectRoot) {
          roots.push({ rootPath: projectRoot.path, scope: "project" });
        }
      }
      if (hasGlobal()) {
        roots.push({ rootPath: getGlobalConfigPath(), scope: "global" });
      }
    } else if (options.local) {
      const projectRoot = await findNearestLoadoutRoot(cwd);
      if (!projectRoot) {
        log.error("Not in a loadout project.");
        process.exit(1);
      }
      roots.push({ rootPath: projectRoot.path, scope: "project" });
    } else if (options.global) {
      if (!hasGlobal()) {
        log.error("No global loadout found.");
        process.exit(1);
      }
      roots.push({ rootPath: getGlobalConfigPath(), scope: "global" });
    }

    if (roots.length === 0) {
      log.error("No loadout found.");
      process.exit(1);
    }

    for (const { rootPath, scope } of roots) {
      const skillsDir = path.join(rootPath, SKILLS_DIR);
      const skills = listFiles(skillsDir).filter((f) =>
        isDirectory(path.join(skillsDir, f))
      );

      const scopeLabel = scope === "global" ? "Global skills" : "Project skills";
      heading(scopeLabel);

      if (skills.length === 0) {
        log.dim("  No skills defined.");
        const flag = scope === "global" ? " -g" : "";
        log.dim(`  Create one with: loadout skill add <name>${flag}`);
        console.log();
        continue;
      }

      for (const name of skills) {
        const skillPath = path.join(skillsDir, name);
        const skillMdPath = path.join(skillPath, "SKILL.md");

        try {
          if (fileExists(skillMdPath)) {
            const content = readFile(skillMdPath);
            const { frontmatter } = parseSkillFrontmatter(content);
            const desc = typeof frontmatter.description === "string"
              ? frontmatter.description
              : "";

            console.log(`  ${name}`);
            if (desc) {
              log.dim(`    ${desc}`);
            }
          } else {
            console.log(`  ${name} (missing SKILL.md)`);
          }
        } catch {
          console.log(`  ${name} (error reading)`);
        }
      }
      console.log();
    }
  });

// loadout skill edit <name>
skillCommand
  .command("edit")
  .description("Edit a skill's SKILL.md in $EDITOR")
  .argument("<name>", "Skill name")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .action(async (name, options) => {
    let rootPath: string;
    let scope: Scope;

    try {
      ({ rootPath, scope } = await resolveRootPath(options));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const skillPath = path.join(rootPath, SKILLS_DIR, name);
    const skillMdPath = path.join(skillPath, "SKILL.md");

    if (!isDirectory(skillPath)) {
      log.error(`Skill '${name}' not found in ${scope} scope.`);
      process.exit(1);
    }

    if (!fileExists(skillMdPath)) {
      log.error(`Skill '${name}' is missing SKILL.md.`);
      process.exit(1);
    }

    await openInEditor(skillMdPath, { cwd: rootPath });

    if (sanitizeSkillFile(skillMdPath)) {
      log.dim("  Canonicalized skill frontmatter");
    }
    log.success(`Edited skill: ${name}`);
  });

// loadout skill remove <name>
skillCommand
  .command("remove")
  .description("Remove a skill")
  .argument("<name>", "Skill name")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .option("-f, --force", "Skip confirmation")
  .action(async (name, options) => {
    let rootPath: string;
    let scope: Scope;

    try {
      ({ rootPath, scope } = await resolveRootPath(options));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const skillPath = path.join(rootPath, SKILLS_DIR, name);

    if (!isDirectory(skillPath)) {
      log.error(`Skill '${name}' not found in ${scope} scope.`);
      process.exit(1);
    }

    if (!options.force) {
      log.warn(`This will delete: ${skillPath}/`);
      log.dim("Use --force to skip this warning.");
      process.exit(1);
    }

    removeDir(skillPath);

    // Rebuild per-target .gitignore files reflecting the deletion
    const projectRoot = scope === "project" ? path.dirname(rootPath) : os.homedir();
    rebuildAllGitignores(rootPath, projectRoot, scope);

    log.success(`Removed skill: ${name} (${scope})`);
  });

/** Find the bundled skills directory. */
function findBundledSkillsPath(): string | null {
  const candidates = [
    // Development: relative to src/cli/commands/
    path.resolve(__dirname, "../../../bundled/skills"),
    // Production: relative to dist/cli/commands/
    path.resolve(__dirname, "../../../bundled/skills"),
  ];

  for (const candidate of candidates) {
    if (isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** List available bundled skills. */
function listBundledSkills(): string[] {
  const bundledPath = findBundledSkillsPath();
  if (!bundledPath) return [];
  return listFiles(bundledPath).filter((f) =>
    isDirectory(path.join(bundledPath, f))
  );
}

// loadout skill import <path>
skillCommand
  .command("import")
  .description("Import an existing skill directory into loadout")
  .argument("[path]", "Path to existing skill directory (or use --builtin)")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .option("--builtin <name>", "Import a bundled skill (e.g., loadouts-usage)")
  .option("--list-builtins", "List available bundled skills")
  .option("--loadout <name>", "Loadout to add skill to", "base")
  .option("--keep", "Keep original directory (don't delete after import)")
  .action(async (dirPath, options) => {
    // Handle --list-builtins
    if (options.listBuiltins) {
      const skills = listBundledSkills();
      if (skills.length === 0) {
        log.error("No bundled skills found.");
        process.exit(1);
      }
      heading("Bundled skills");
      for (const name of skills) {
        console.log(`  ${name}`);
      }
      console.log();
      log.dim("Import with: loadout skill import --builtin <name>");
      return;
    }
    const cwd = process.cwd();
    let rootPath: string;
    let scope: Scope;

    try {
      ({ rootPath, scope } = await resolveRootPath(options, cwd));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Resolve the source path
    let sourcePath: string;
    let keepOriginal = options.keep;

    if (options.builtin) {
      // Import from bundled skills
      const bundledPath = findBundledSkillsPath();
      if (!bundledPath) {
        log.error("Bundled skills directory not found.");
        process.exit(1);
      }
      sourcePath = path.join(bundledPath, options.builtin);
      keepOriginal = true; // Never delete bundled skills
    } else if (dirPath) {
      sourcePath = path.isAbsolute(dirPath)
        ? dirPath
        : path.resolve(cwd, dirPath);
    } else {
      log.error("Provide a path or use --builtin <name>");
      log.dim("List bundled skills: loadout skill import --list-builtins");
      process.exit(1);
    }

    if (!isDirectory(sourcePath)) {
      log.error(`Directory not found: ${sourcePath}`);
      process.exit(1);
    }

    // Check for SKILL.md
    const skillMdPath = path.join(sourcePath, "SKILL.md");
    if (!fileExists(skillMdPath)) {
      log.error(`Not a valid skill directory (missing SKILL.md): ${sourcePath}`);
      process.exit(1);
    }

    // Determine the skill name from directory name
    const name = path.basename(sourcePath);
    const destPath = path.join(rootPath, SKILLS_DIR, name);

    if (isDirectory(destPath)) {
      log.error(`Skill '${name}' already exists in ${scope} scope.`);
      process.exit(1);
    }

    // Copy the directory
    copyDir(sourcePath, destPath);

    const importedSkillMdPath = path.join(destPath, "SKILL.md");
    if (sanitizeSkillFile(importedSkillMdPath)) {
      log.dim("  Canonicalized skill frontmatter");
    }

    // Add to loadout definition
    const loadoutPath = path.join(rootPath, "loadouts", `${options.loadout}.yaml`);

    if (fileExists(loadoutPath)) {
      try {
        const def = parseLoadoutDefinition(loadoutPath);
        const includeEntry = `skills/${name}`;

        if (!def.include.some((i) =>
          (typeof i === "string" ? i : i.path) === includeEntry
        )) {
          def.include.push(includeEntry);
          writeFile(loadoutPath, yaml.stringify(def));
          log.success(`Added to ${options.loadout} loadout`);
        }
      } catch (err) {
        log.warn(`Could not update loadout: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Rebuild per-target .gitignore files for all existing artifacts
    const projectRoot = scope === "project" ? path.dirname(rootPath) : os.homedir();
    rebuildAllGitignores(rootPath, projectRoot, scope);

    // Remove original if not --keep (and not a builtin)
    if (!keepOriginal) {
      removeDir(sourcePath);
      log.dim(`Removed original: ${sourcePath}`);
    }

    log.success(`Imported skill: ${name} (${scope})`);
    log.dim(`  ${destPath}/`);
  });
