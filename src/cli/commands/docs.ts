/**
 * loadout docs — Display documentation.
 *
 * Usage:
 *   loadout docs              # Show index/overview
 *   loadout docs quickstart   # Show specific topic
 *   loadout docs --list       # List available topics
 *   loadout docs --raw        # Print without pager
 */

import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Available documentation topics with descriptions. */
const TOPICS: Record<string, string> = {
  index: "Overview and quick reference",
  quickstart: "Get started in 60 seconds",
  concepts: "Loadouts, artifacts, scopes, tools",
  commands: "Full command reference",
  runtime: "OpenCode-first runtime activation architecture",
  authoring: "Creating rules, skills, instructions",
  compatibility: "Tool paths and frontmatter compatibility",
  workflows: "Team setup, git, CI/CD",
  troubleshooting: "Common issues and solutions",
};

/**
 * Find a docs file by topic name. Tries multiple locations:
 * 1. Relative to the CLI source (development)
 * 2. Relative to the installed package (production)
 */
function findDocsPath(topic: string): string | null {
  const filename = `${topic}.md`;
  const candidates = [
    // Development: relative to src/cli/commands/
    path.resolve(__dirname, "../../../docs", filename),
    // Production: relative to dist/cli/commands/
    path.resolve(__dirname, "../../../docs", filename),
    // Fallback: look in package root
    path.resolve(__dirname, "../../docs", filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/** List available topics with descriptions. */
function listTopics(): void {
  console.log(chalk.bold("\nAvailable documentation topics:\n"));
  
  const maxLen = Math.max(...Object.keys(TOPICS).map(k => k.length));
  
  for (const [topic, description] of Object.entries(TOPICS)) {
    if (topic === "index") continue; // Skip index in listing
    const padded = topic.padEnd(maxLen + 2);
    console.log(`  ${chalk.cyan(padded)} ${chalk.dim(description)}`);
  }
  
  console.log();
  console.log(chalk.dim("Usage: loadout docs <topic>"));
  console.log();
}

/** Display documentation through pager or stdout. */
function displayDocs(content: string, usePager: boolean): void {
  if (!usePager || !process.stdout.isTTY) {
    console.log(content);
    return;
  }

  const pager = process.env.PAGER || "less";
  const pagerArgs = pager === "less" ? ["-R"] : [];

  const child = spawn(pager, pagerArgs, {
    stdio: ["pipe", "inherit", "inherit"],
  });

  child.stdin.write(content);
  child.stdin.end();

  child.on("error", () => {
    // Pager not found, print directly
    console.log(content);
  });
}

export const docsCommand = new Command("docs")
  .description("Display documentation")
  .argument("[topic]", "Documentation topic (quickstart, concepts, commands, runtime, authoring, compatibility, workflows, troubleshooting)")
  .option("--list", "List available topics")
  .option("--raw", "Print raw markdown without pager")
  .action(async (topic: string | undefined, options: { list?: boolean; raw?: boolean }) => {
    if (options.list) {
      listTopics();
      return;
    }

    // Default to index if no topic specified
    const targetTopic = topic || "index";

    // Validate topic
    if (!TOPICS[targetTopic]) {
      console.error(chalk.red(`Unknown topic: ${targetTopic}`));
      console.error();
      console.error("Available topics:");
      for (const t of Object.keys(TOPICS)) {
        if (t !== "index") console.error(`  ${t}`);
      }
      console.error();
      console.error("Use: loadout docs <topic>");
      process.exit(1);
    }

    const docsPath = findDocsPath(targetTopic);

    if (!docsPath) {
      console.error(chalk.red(`Documentation file not found: ${targetTopic}.md`));
      console.error("Visit: https://github.com/evatths/loadout");
      process.exit(1);
    }

    const content = fs.readFileSync(docsPath, "utf-8");
    displayDocs(content, !options.raw);
  });
