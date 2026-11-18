/**
 * loadouts instructions - Manage per-loadout instruction files
 * 
 * Instructions are stored as instructions/<loadout>.md and rendered to AGENTS.md
 */

import { Command } from "commander";
import * as path from "node:path";
import { findNearestLoadoutRoot, getProjectRoot } from "../../core/discovery.js";
import { loadState } from "../../core/manifest.js";
import { writeFile, readFile, fileExists, removeFile, copyFile, ensureDir } from "../../lib/fs.js";
import { log } from "../../lib/output.js";
import { spawn } from "node:child_process";
import { authorName, authorRoot, authorPath } from "./private.js";

const INSTRUCTIONS_DIR = "instructions";

/**
 * Get the instruction file path for a loadout.
 */
function getInstructionPath(loadoutPath: string, loadoutName: string): string {
  return path.join(loadoutPath, INSTRUCTIONS_DIR, `AGENTS.${loadoutName}.md`);
}

/**
 * Get the active loadout name, or default to "base".
 */
function getActiveLoadout(loadoutPath: string): string {
  const state = loadState(loadoutPath);
  const active = state?.active ?? [];
  return active.length > 0 ? active[0] : "base";
}

export const instructionsCommand = new Command("instructions").description(
  "Manage per-loadout instruction files"
);

// loadouts instructions init [loadout]
instructionsCommand
  .command("init")
  .description("Create an instruction file for a loadout")
  .argument("[loadout]", "Loadout name (default: active loadout or 'base')")
  .option("-f, --force", "Overwrite existing file")
  .action(async (loadoutName, options) => {
    const privateAuthor = await authorRoot();
    const nearestRoot = privateAuthor ? { path: privateAuthor.rootPath } : await findNearestLoadoutRoot(process.cwd());

    if (!nearestRoot) {
      log.error("No .loadouts/ directory found. Run 'loadouts init' first.");
      process.exit(1);
    }

    const targetLoadout = loadoutName || getActiveLoadout(nearestRoot.path);
    if (privateAuthor) authorName(targetLoadout);
    const filePath = privateAuthor ? authorPath(privateAuthor.project, `instructions/AGENTS.${targetLoadout}.md`) : getInstructionPath(nearestRoot.path, targetLoadout);

    if (fileExists(filePath) && !options.force) {
      log.warn(`Instruction file already exists: ${filePath}`);
      log.dim(`Edit it with: loadouts instructions edit ${targetLoadout}`);
      log.dim("Or overwrite with: loadouts instructions init --force");
      process.exit(1);
    }

    const content = `# Project Instructions

> These instructions are always included for AI coding agents when the **${targetLoadout}** loadout is active.

## Quick Reference

- Build: \`npm run build\`
- Test: \`npm test\`
- Lint: \`npm run lint\`

## Project Overview

Describe your project here.

## Guidelines

### Code Style

- Prefer descriptive names over comments
- Keep functions small and focused
- Write tests for new functionality

### Architecture

Describe key architectural decisions.

## Done Means

When completing a task:

- [ ] Code compiles without errors
- [ ] Tests pass
- [ ] No lint warnings
- [ ] Changes are documented if needed
`;

    ensureDir(path.dirname(filePath));
    writeFile(filePath, content);
    log.success(`Created: instructions/AGENTS.${targetLoadout}.md`);
    console.log();
    console.log(`  File: ${filePath}`);
    console.log();
    log.dim("  Replace the template content with your instructions, then run 'loadouts sync'");
    log.dim(`  Don't forget to add 'instructions/AGENTS.${targetLoadout}.md' to your loadout's include list.`);
  });

// loadouts instructions edit [loadout]
instructionsCommand
  .command("edit")
  .description("Edit an instruction file in $EDITOR")
  .argument("[loadout]", "Loadout name (default: active loadout or 'base')")
  .action(async (loadoutName) => {
    const privateAuthor = await authorRoot();
    const nearestRoot = privateAuthor ? { path: privateAuthor.rootPath } : await findNearestLoadoutRoot(process.cwd());

    if (!nearestRoot) {
      log.error("No .loadouts/ directory found.");
      process.exit(1);
    }

    const targetLoadout = loadoutName || getActiveLoadout(nearestRoot.path);
    if (privateAuthor) authorName(targetLoadout);
    const filePath = privateAuthor ? authorPath(privateAuthor.project, `instructions/AGENTS.${targetLoadout}.md`) : getInstructionPath(nearestRoot.path, targetLoadout);

    if (!fileExists(filePath)) {
      log.error(`Instruction file not found: instructions/AGENTS.${targetLoadout}.md`);
      log.dim(`Create it with: loadouts instructions init ${targetLoadout}`);
      process.exit(1);
    }

    const editor = process.env.EDITOR || process.env.VISUAL || "vim";

    const child = spawn(editor, [filePath], {
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        log.success(`Edited instructions/AGENTS.${targetLoadout}.md`);
      }
    });
  });

// loadouts instructions import [path]
instructionsCommand
  .command("import")
  .description("Import an existing instruction file into loadout")
  .argument("[path]", "Path to existing file (defaults to ./AGENTS.md or ./CLAUDE.md)")
  .option("--loadout <name>", "Target loadout (default: active loadout or 'base')")
  .option("--keep", "Keep original file (don't delete after import)")
  .option("-f, --force", "Overwrite existing instruction file")
  .action(async (filePath, options) => {
    const cwd = process.cwd();
    const projectRoot = await getProjectRoot(cwd);
    const nearestRoot = await findNearestLoadoutRoot(cwd);

    if (!nearestRoot) {
      log.error("No .loadouts/ directory found. Run 'loadouts init' first.");
      process.exit(1);
    }

    const targetLoadout = options.loadout || getActiveLoadout(nearestRoot.path);

    // Auto-detect source if not provided
    let sourcePath: string;
    if (filePath) {
      sourcePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(cwd, filePath);
    } else {
      // Try AGENTS.md first, then CLAUDE.md
      const agentsPath = path.join(projectRoot, "AGENTS.md");
      const claudePath = path.join(projectRoot, "CLAUDE.md");

      if (fileExists(agentsPath)) {
        sourcePath = agentsPath;
      } else if (fileExists(claudePath)) {
        sourcePath = claudePath;
      } else {
        log.error("No AGENTS.md or CLAUDE.md found in project root.");
        log.dim("Specify a path: loadouts instructions import <path>");
        process.exit(1);
      }
    }

    if (!fileExists(sourcePath)) {
      log.error(`File not found: ${sourcePath}`);
      process.exit(1);
    }

    const destPath = getInstructionPath(nearestRoot.path, targetLoadout);

    if (fileExists(destPath) && !options.force) {
      log.error(`instructions/AGENTS.${targetLoadout}.md already exists`);
      log.dim("Use --force to overwrite it with the imported file.");
      process.exit(1);
    }

    // Copy the file
    ensureDir(path.dirname(destPath));
    copyFile(sourcePath, destPath);

    // Remove original if not --keep
    if (!options.keep) {
      removeFile(sourcePath);
      log.dim(`Removed original: ${sourcePath}`);
    }

    log.success(`Imported to instructions/AGENTS.${targetLoadout}.md`);
    log.dim(`Don't forget to add 'instructions/AGENTS.${targetLoadout}.md' to your loadout's include list.`);
    log.info("Run 'loadouts sync' to apply changes.");
  });

// loadouts instructions list
instructionsCommand
  .command("list")
  .description("List instruction files")
  .action(async () => {
    const nearestRoot = await findNearestLoadoutRoot(process.cwd());

    if (!nearestRoot) {
      log.error("No .loadouts/ directory found.");
      process.exit(1);
    }

    const instructionsDir = path.join(nearestRoot.path, INSTRUCTIONS_DIR);
    
    if (!fileExists(instructionsDir)) {
      log.dim("No instruction files found.");
      log.dim("Create one with: loadouts instructions init <loadout>");
      return;
    }

    const fs = await import("node:fs");
    const files = fs.readdirSync(instructionsDir)
      .filter(f => f.startsWith("AGENTS.") && f.endsWith(".md"))
      .map(f => f.replace(/^AGENTS\./, "").replace(/\.md$/, ""));

    if (files.length === 0) {
      log.dim("No instruction files found.");
      log.dim("Create one with: loadouts instructions init <loadout>");
      return;
    }

    const activeLoadout = getActiveLoadout(nearestRoot.path);

    console.log();
    log.info("Instruction files:");
    for (const file of files) {
      const isActive = file === activeLoadout;
      const marker = isActive ? " (active)" : "";
      console.log(`  AGENTS.${file}.md${marker}`);
    }
    console.log();
  });
