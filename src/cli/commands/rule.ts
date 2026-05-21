/**
 * loadout rule — Manage rules.
 *
 * Scope flags:
 *   -l / --local   → project scope
 *   -g / --global  → global scope
 *   (none)         → project if in one, else global
 */

import { Command } from "commander";
import * as path from "node:path";
import * as yaml from "yaml";
import {
  findNearestLoadoutRoot,
  getProjectRoot,
  getGlobalRoot,
  getGlobalConfigPath,
} from "../../core/discovery.js";
import {
  writeFile,
  readFile,
  fileExists,
  removeFile,
  copyFile,
  listFilesWithExtension,
} from "../../lib/fs.js";
import { parseFrontmatter, parseLoadoutDefinition, sanitizeRuleFrontmatter, sanitizeRuleFile, serializeFrontmatter } from "../../core/config.js";
import { inProject, hasGlobal, type ScopeFlags } from "../../core/scope.js";
import { log, heading, list } from "../../lib/output.js";
import { openInEditor } from "../../lib/editor.js";
import { rebuildAllGitignores } from "../../lib/gitignore.js";
import * as os from "node:os";
import type { Scope } from "../../core/types.js";

const RULES_DIR = "rules";

interface RuleScopeOptions {
  local?: boolean;
  global?: boolean;
  noEdit?: boolean;
}

/**
 * Resolve the loadout root path based on scope flags.
 */
async function resolveRootPath(
  options: RuleScopeOptions,
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

export const ruleCommand = new Command("rule").description("Manage rules");

// loadout rule add <name>
ruleCommand
  .command("add")
  .description("Create a new rule")
  .argument("<name>", "Rule name (without .md extension)")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .option("-d, --description <desc>", "Rule description")
  .option("-p, --paths <paths...>", "File path patterns")
  .option("--always-apply", "Always apply this rule")
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

    const rulePath = path.join(rootPath, RULES_DIR, `${name}.md`);

    if (fileExists(rulePath)) {
      log.error(`Rule '${name}' already exists in ${scope} scope.`);
      process.exit(1);
    }

    let frontmatter: Record<string, unknown> = {};

    if (options.description) {
      frontmatter.description = options.description;
    }
    if (options.paths) {
      frontmatter.paths = options.paths;
    }
    if (options.alwaysApply) {
      frontmatter.alwaysApply = true;
    }

    // Canonicalize generated frontmatter before writing the source artifact.
    frontmatter = sanitizeRuleFrontmatter(frontmatter, name);

    const body = `\n# ${name}\n\nAdd your rule content here.\n`;
    const content = serializeFrontmatter(frontmatter, body);

    writeFile(rulePath, content);

    // Rebuild per-target .gitignore files for all existing artifacts
    const projectRoot = scope === "project" ? path.dirname(rootPath) : os.homedir();
    rebuildAllGitignores(rootPath, projectRoot, scope);

    const scopeLabel = scope === "global" ? "global" : "project";
    log.success(`Created ${scopeLabel} rule: ${name}`);

    // Open in editor unless --no-edit (Commander sets options.edit = false for --no-edit)
    if (options.edit !== false) {
      log.dim(`  ${rulePath}`);
      await openInEditor(rulePath, { cwd: rootPath });
      if (sanitizeRuleFile(rulePath)) {
        log.dim("  Canonicalized rule frontmatter");
      }
    } else {
      // For agents/scripts: show clear path and instructions
      console.log();
      console.log(`  File: ${rulePath}`);
      console.log();
      log.dim("  Replace the template content with your rule, then run 'loadouts sync'");
    }
  });

// loadout rule list
ruleCommand
  .command("list")
  .description("List rules")
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
      const rulesDir = path.join(rootPath, RULES_DIR);
      const rules = listFilesWithExtension(rulesDir, ".md");

      const scopeLabel = scope === "global" ? "Global rules" : "Project rules";
      heading(scopeLabel);

      if (rules.length === 0) {
        log.dim("  No rules defined.");
        const flag = scope === "global" ? " -g" : "";
        log.dim(`  Create one with: loadout rule add <name>${flag}`);
        console.log();
        continue;
      }

      for (const file of rules) {
        const name = file.replace(/\.md$/, "");
        const rulePath = path.join(rulesDir, file);

        try {
          const content = readFile(rulePath);
          const { frontmatter } = parseFrontmatter(content);

          const desc = frontmatter.description || "";
          const paths = frontmatter.paths?.join(", ") || "all files";

          console.log(`  ${name}`);
          if (desc) {
            log.dim(`    ${desc}`);
          }
          log.dim(`    paths: ${paths}`);
        } catch {
          console.log(`  ${name} (error reading)`);
        }
      }
      console.log();
    }
  });

// loadout rule edit <name>
ruleCommand
  .command("edit")
  .description("Edit a rule in $EDITOR")
  .argument("<name>", "Rule name")
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

    const rulePath = path.join(rootPath, RULES_DIR, `${name}.md`);

    if (!fileExists(rulePath)) {
      log.error(`Rule '${name}' not found in ${scope} scope.`);
      process.exit(1);
    }

    await openInEditor(rulePath, { cwd: rootPath });

    if (sanitizeRuleFile(rulePath)) {
      log.dim("  Canonicalized rule frontmatter");
    }
    log.success(`Edited rule: ${name}`);
  });

// loadout rule remove <name>
ruleCommand
  .command("remove")
  .description("Remove a rule")
  .argument("<name>", "Rule name")
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

    const rulePath = path.join(rootPath, RULES_DIR, `${name}.md`);

    if (!fileExists(rulePath)) {
      log.error(`Rule '${name}' not found in ${scope} scope.`);
      process.exit(1);
    }

    if (!options.force) {
      log.warn(`This will delete: ${rulePath}`);
      log.dim("Use --force to skip this warning.");
      process.exit(1);
    }

    removeFile(rulePath);

    // Rebuild per-target .gitignore files reflecting the deletion
    const projectRoot = scope === "project" ? path.dirname(rootPath) : os.homedir();
    rebuildAllGitignores(rootPath, projectRoot, scope);

    log.success(`Removed rule: ${name} (${scope})`);
  });

// loadout rule import <path>
ruleCommand
  .command("import")
  .description("Import an existing rule file into loadout")
  .argument("<path>", "Path to existing rule file")
  .option("-l, --local", "Project scope")
  .option("-g, --global", "Global scope")
  .option("--loadout <name>", "Loadout to add rule to", "base")
  .option("--keep", "Keep original file (don't delete after import)")
  .action(async (filePath, options) => {
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
    const sourcePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(cwd, filePath);

    if (!fileExists(sourcePath)) {
      log.error(`File not found: ${sourcePath}`);
      process.exit(1);
    }

    // Determine the rule name from filename
    const basename = path.basename(sourcePath);
    const name = basename.replace(/\.(md|mdc)$/, "");
    const destPath = path.join(rootPath, RULES_DIR, `${name}.md`);

    if (fileExists(destPath)) {
      log.error(`Rule '${name}' already exists in ${scope} scope.`);
      process.exit(1);
    }

    // Copy the file
    copyFile(sourcePath, destPath);

    // Canonicalize known native frontmatter aliases on import.
    if (sanitizeRuleFile(destPath)) {
      log.dim("  Canonicalized rule frontmatter");
    }

    // Add to loadout definition
    const loadoutPath = path.join(rootPath, "loadouts", `${options.loadout}.yaml`);

    if (fileExists(loadoutPath)) {
      try {
        const def = parseLoadoutDefinition(loadoutPath);
        const includeEntry = `rules/${name}.md`;

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

    // Remove original if not --keep
    if (!options.keep) {
      removeFile(sourcePath);
      log.dim(`Removed original: ${sourcePath}`);
    }

    log.success(`Imported rule: ${name} (${scope})`);
    log.dim(`  ${destPath}`);
  });
