/**
 * loadout create — Create a new loadout definition.
 *
 * Scope flags:
 *   -l / --local   → create in project .loadouts/
 *   -g / --global  → create in ~/.config/loadouts
 *   (none)         → project if in one, else global
 */

import { Command } from "commander";
import * as path from "node:path";
import * as yaml from "yaml";
import { findNearestLoadoutRoot, getGlobalRoot, getGlobalConfigPath } from "../../core/discovery.js";
import { inProject, hasGlobal, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { writeFile, fileExists } from "../../lib/fs.js";
import { log, heading } from "../../lib/output.js";
import { openInEditor } from "../../lib/editor.js";
import type { Scope } from "../../core/types.js";
import { authorName, authorRoot, authorPath } from "./private.js";

interface CreateOptions extends ScopeFlags {
  description?: string;
  edit?: boolean;
}

export const createCommand = new Command("create")
  .description("Create a new loadout definition")
  .argument("<name>", "Loadout name")
  .option("-d, --description <desc>", "Loadout description")
  .option("--no-edit", "Don't open in editor after creating")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .action(async (name: string, options: CreateOptions) => {
    const cwd = process.cwd();
    const privateAuthor = await authorRoot(options, cwd);
    if (privateAuthor) authorName(name);

    // Resolve scope
    let scope: Scope;
    let rootPath: string;

    if (privateAuthor) {
      scope = "project";
      rootPath = privateAuthor.rootPath;
    } else if (options.local) {
      const projectRoot = await findNearestLoadoutRoot(cwd);
      if (!projectRoot) {
        log.error("Not in a loadout project. Run 'loadout init' first.");
        process.exit(1);
      }
      scope = "project";
      rootPath = projectRoot.path;
    } else if (options.global) {
      if (!hasGlobal()) {
        log.error("No global loadout found. Run 'loadout init --global' first.");
        process.exit(1);
      }
      scope = "global";
      rootPath = getGlobalConfigPath();
    } else {
      // Auto-detect: prefer project if in one
      if (await inProject(cwd)) {
        const projectRoot = await findNearestLoadoutRoot(cwd);
        scope = "project";
        rootPath = projectRoot!.path;
      } else if (hasGlobal()) {
        scope = "global";
        rootPath = getGlobalConfigPath();
      } else {
        log.error("No loadout found. Run 'loadout init' or 'loadout init --global' first.");
        process.exit(1);
      }
    }

    const loadoutPath = privateAuthor ? authorPath(privateAuthor.project, `loadouts/${name}.yaml`) : path.join(rootPath, "loadouts", `${name}.yaml`);

    if (fileExists(loadoutPath) || (privateAuthor && fileExists(authorPath(privateAuthor.project, `loadouts/${name}.yml`)))) {
      log.error(`Loadout '${name}' already exists in ${scope} scope.`);
      process.exit(1);
    }

    // Build a documented template for the loadout
    const description = options.description || `${name} loadout`;
    
    const template = `# yaml-language-server: $schema=loadout-schema.json
#
# Loadout: ${name}
# ${description}
#
# A loadout defines which artifacts (rules, skills, prompts, etc.) are
# activated together. Use 'include' to add artifacts from this .loadouts/
# directory.
#
# Examples:
#   include:
#     - rules/coding-standards.md    # A single rule file
#     - skills/debugging             # A skill directory
#     - prompts/review.md            # A prompt template
#
# Per-item tool overrides:
#   include:
#     - path: rules/cursor-only.md
#       tools: [cursor]              # Only render for Cursor
#
# Tool targeting (default: all tools):
#   tools: [claude-code, cursor]     # Only target specific tools

name: ${name}
description: ${description}

# Add your artifacts here:
include: []
`;

    writeFile(loadoutPath, template);

    const scopeLabel = scope === "global" ? "global" : "project";
    heading(`Created ${scopeLabel} loadout: ${name}`);
    log.success(`Written to: ${loadoutPath}`);

    // Open in editor unless --no-edit (Commander sets options.edit = false)
    if (options.edit !== false) {
      await openInEditor(loadoutPath, { cwd: rootPath });
    } else {
      console.log();
      log.info("Next steps:");
      log.dim(`  1. Edit ${loadoutPath} to add includes`);
      const flag = scope === "global" ? " -g" : "";
      log.dim(`  2. Activate with: loadout activate ${name}${flag}`);
    }
  });
