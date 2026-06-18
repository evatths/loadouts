/**
 * loadouts init — Initialize a loadout.
 *
 * Scope:
 *   -l / --local   → init in current directory (default)
 *   -g / --global  → init at ~/.config/loadouts
 *
 * Unlike other commands, init defaults to local (most common use case).
 */

import { Command } from "commander";
import * as path from "node:path";
import * as os from "node:os";
import * as yaml from "yaml";
import { ensureDir, writeFile, fileExists } from "../../lib/fs.js";
import { writeFallbackScript, writeGitHooks, ENVRC_LINES } from "../../core/fallback.js";
import { findGitRoot } from "../../lib/git.js";
import { getContext, getGlobalConfigPath } from "../../core/discovery.js";
import { loadResolvedLoadout } from "../../core/resolve.js";
import { planRender, applyPlan } from "../../core/render.js";
import { log, heading, list } from "../../lib/output.js";
import { updateLoadoutsGitignore } from "../../lib/gitignore.js";
import type { RootConfig, Scope } from "../../core/types.js";
import { discoverImportableArtifacts } from "../../core/import-discovery.js";
import { runInstall } from "./install.js";
import * as readline from "node:readline";

async function initLoadout(
  scope: Scope,
  options: { force?: boolean }
): Promise<void> {
  const loadoutPath =
    scope === "global"
      ? getGlobalConfigPath()
      : path.join(process.cwd(), ".loadouts");

  const scopeLabel = scope === "global" ? "global" : "project";

  if (fileExists(loadoutPath) && !options.force) {
    log.error(
      `${scopeLabel === "global" ? "~/.config/loadouts" : ".loadouts/"} already exists. Use --force to reinitialize.`
    );
    process.exit(1);
  }

  // Create directory structure
  ensureDir(path.join(loadoutPath, "instructions"));
  ensureDir(path.join(loadoutPath, "rules"));
  ensureDir(path.join(loadoutPath, "skills"));
  ensureDir(path.join(loadoutPath, "agents"));
  ensureDir(path.join(loadoutPath, "loadouts"));

  // Create root config
  const rootConfig: RootConfig = {
    version: "1",
  };
  writeFile(
    path.join(loadoutPath, "loadouts.yaml"),
    yaml.stringify(rootConfig)
  );

  // Create base loadout
  const defaultLoadout = {
    name: "base",
    description: `Base ${scopeLabel} loadout`,
    include: scope === "project" ? ["instructions/AGENTS.base.md"] : ([] as string[]),
  };
  writeFile(
    path.join(loadoutPath, "loadouts", "base.yaml"),
    yaml.stringify(defaultLoadout)
  );

  // Create placeholder AGENTS.md (project only)
  if (scope === "project") {
    const agentsContent = `# Project Instructions

> Edit this file to provide always-on instructions for AI coding agents.

## Quick Reference

- Build: \`npm run build\`
- Test: \`npm test\`

## Guidelines

Add your project-specific guidelines here.
`;
    writeFile(path.join(loadoutPath, "instructions", "AGENTS.base.md"), agentsContent);

    // Create fallback script (always)
    writeFallbackScript(loadoutPath);

    // Create git hooks only if we're at git root (they don't work for subprojects)
    const projectRoot = process.cwd();
    const gitRoot = await findGitRoot(projectRoot);
    const isAtGitRoot = gitRoot === projectRoot;
    
    if (isAtGitRoot) {
      writeGitHooks(loadoutPath);
    }
    const envrcPath = path.join(projectRoot, ".envrc");
    
    if (fileExists(envrcPath)) {
      const existingContent = await import("node:fs").then(fs => fs.readFileSync(envrcPath, "utf-8"));
      if (!existingContent.includes("sync-fallback.sh")) {
        writeFile(envrcPath, existingContent + ENVRC_LINES);
      }
    } else {
      writeFile(envrcPath, ENVRC_LINES.trim() + "\n");
    }
  }

  // Write .loadouts/.gitignore to cover state files
  updateLoadoutsGitignore(loadoutPath);

  const displayPath = scope === "global" ? "~/.config/loadouts" : ".loadouts/";
  heading(`Initialized ${displayPath}`);
  log.success(`Created ${displayPath}loadouts.yaml`);
  log.success(`Created ${displayPath}loadouts/base.yaml`);
  if (scope === "project") {
    log.success(`Created ${displayPath}instructions/AGENTS.base.md`);
  }
  log.success(`Created ${displayPath}instructions/`);
  log.success(`Created ${displayPath}rules/`);
  log.success(`Created ${displayPath}skills/`);
  log.success(`Created ${displayPath}agents/`);
  if (scope === "project") {
    log.success(`Created ${displayPath}sync-fallback.sh`);
    const gitRoot = await findGitRoot(process.cwd());
    const isAtGitRoot = gitRoot === process.cwd();
    if (isAtGitRoot) {
      log.success(`Created ${displayPath}hooks/ (git hooks)`);
    } else {
      log.dim(`Skipped git hooks (subproject - use direnv instead)`);
    }
    log.success(`Updated .envrc (direnv integration)`);
  }
  console.log();

  // Auto-apply the base loadout
  log.info("Applying base loadout...");
  try {
    const cwd = scope === "global" ? os.homedir() : process.cwd();
    const ctx = await getContext(scope, cwd);
    const { loadout, rootConfig: resolvedRootConfig } = await loadResolvedLoadout(ctx, "base");
    const plan = await planRender(loadout, ctx.projectRoot, ctx.scope, ctx.configPath);

    if (plan.errors.length > 0) {
      log.warn("Could not apply loadout:");
      list(plan.errors);
    } else {
      await applyPlan(plan, loadout, ctx.projectRoot, resolvedRootConfig.mode, ctx.scope);
      log.success(`${plan.outputs.length} outputs written`);

      if (plan.shadowed.length > 0) {
        console.log();
        log.warn(`${plan.shadowed.length} outputs shadowed by existing unmanaged files:`);
        for (const s of plan.shadowed) {
          log.dim(`  ${s.targetPath}  (${s.tool})`);
        }
        log.dim("These take precedence. Import them to bring under loadout management.");
      }
    }
  } catch (err) {
    log.warn(`Auto-apply failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log();
  // Check for existing configurations to import (project scope only)
  if (scope === "project") {
    const projectRoot = process.cwd();
    const discovery = discoverImportableArtifacts(projectRoot, {
      loadoutPath,
    });

    if (discovery.artifacts.length > 0) {
      console.log();
      log.info(`Found ${discovery.artifacts.length} existing configuration(s) to import`);
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question("Import them now? [Y/n] ", (ans) => {
          resolve(ans.trim().toLowerCase());
          rl.close();
        });
      });

      if (answer !== "n" && answer !== "no") {
        await runInstall(
          {
            scope: "project",
            configPath: loadoutPath,
            statePath: path.join(loadoutPath, ".state.json"),
            projectRoot,
          },
          {
          to: "base",
          }
        );
      } else {
        log.dim("Skipped. Run 'loadouts install' later to import existing configs.");
      }
    }
  }

  console.log();
  log.info("Next steps:");
  if (scope === "project") {
    log.dim("  • Edit .loadouts/instructions/AGENTS.base.md with your project instructions");
    log.dim("  • Add rules with: loadouts rule add <name>");
    log.dim("  • Add agents by creating .loadouts/agents/<name>.md");
    log.dim("  • Run 'loadouts sync' to re-sync after changes");
    console.log();
    const gitRoot = await findGitRoot(process.cwd());
    const isAtGitRoot = gitRoot === process.cwd();
    if (isAtGitRoot) {
      log.info("Team setup (choose one):");
      log.dim("  • Git hooks: git config core.hooksPath .loadouts/hooks");
      log.dim("  • Direnv:    direnv allow");
    } else {
      log.info("Team setup:");
      log.dim("  • Direnv: direnv allow");
      log.dim("  (Git hooks not available for subprojects)");
    }
  } else {
    log.dim("  • Add rules with: loadouts rule add <name> -g");
    log.dim("  • Add skills with: loadouts skill add <name> -g");
    log.dim("  • Add agents in ~/.config/loadouts/agents/<name>.md");
    log.dim("  • Run 'loadouts sync -g' to re-sync after changes");
  }
}

/**
 * Minimal project initialization for use by install command.
 * Creates the directory structure without prompts or auto-apply.
 * Returns the path to the created .loadouts/ directory.
 */
export async function initProjectLoadout(projectRoot: string): Promise<string> {
  const loadoutPath = path.join(projectRoot, ".loadouts");

  // Create directory structure
  ensureDir(path.join(loadoutPath, "instructions"));
  ensureDir(path.join(loadoutPath, "rules"));
  ensureDir(path.join(loadoutPath, "skills"));
  ensureDir(path.join(loadoutPath, "agents"));
  ensureDir(path.join(loadoutPath, "loadouts"));

  // Create root config
  const rootConfig: RootConfig = {
    version: "1",
  };
  writeFile(
    path.join(loadoutPath, "loadouts.yaml"),
    yaml.stringify(rootConfig)
  );

  // Create base loadout (empty - install will populate it)
  const defaultLoadout = {
    name: "base",
    description: "Base project loadout",
    include: [] as string[],
  };
  writeFile(
    path.join(loadoutPath, "loadouts", "base.yaml"),
    yaml.stringify(defaultLoadout)
  );

  // Create fallback script
  writeFallbackScript(loadoutPath);

  // Create git hooks only if we're at git root
  const gitRoot = await findGitRoot(projectRoot);
  const isAtGitRoot = gitRoot === projectRoot;
  if (isAtGitRoot) {
    writeGitHooks(loadoutPath);
  }

  // Update .envrc
  const envrcPath = path.join(projectRoot, ".envrc");
  if (fileExists(envrcPath)) {
    const existingContent = await import("node:fs").then(fs => fs.readFileSync(envrcPath, "utf-8"));
    if (!existingContent.includes("sync-fallback.sh")) {
      writeFile(envrcPath, existingContent + ENVRC_LINES);
    }
  } else {
    writeFile(envrcPath, ENVRC_LINES.trim() + "\n");
  }

  // Write .loadouts/.gitignore to cover state files
  updateLoadoutsGitignore(loadoutPath);

  heading("Initialized .loadouts/");
  log.success("Created .loadouts/loadouts.yaml");
  log.success("Created .loadouts/loadouts/base.yaml");
  if (isAtGitRoot) {
    log.success("Created .loadouts/hooks/ (git hooks)");
  }
  log.success("Updated .envrc (direnv integration)");
  console.log();

  return loadoutPath;
}

export const initCommand = new Command("init")
  .description("Initialize a loadout")
  .option("-l, --local", "Initialize in current directory (default)")
  .option("-g, --global", "Initialize at ~/.config/loadouts")
  .option("--force", "Overwrite existing loadout")
  .action(async (options: { local?: boolean; global?: boolean; force?: boolean }) => {
    // Require explicit scope or default to local
    const scope: Scope = options.global ? "global" : "project";
    await initLoadout(scope, options);
  });
