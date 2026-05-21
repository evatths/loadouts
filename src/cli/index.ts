/**
 * CLI setup with Commander
 *
 * All commands support scope flags:
 *   -l / --local   → project scope
 *   -g / --global  → global scope
 *   -a / --all     → both scopes (default for status/list/sync/clear)
 */

import { Command, Help } from "commander";
import chalk from "chalk";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
import { initCommand } from "./commands/init.js";
import { activateCommand } from "./commands/activate.js";
import { deactivateCommand } from "./commands/deactivate.js";
import { syncCommand } from "./commands/sync.js";
import { clearCommand } from "./commands/clear.js";
import { removeCommand } from "./commands/remove.js";
import { createCommand } from "./commands/create.js";
import { listCommand } from "./commands/list.js";
import { checkCommand } from "./commands/check.js";
import { statusCommand } from "./commands/status.js";
import { ruleCommand } from "./commands/rule.js";
import { skillCommand } from "./commands/skill.js";
import { instructionsCommand } from "./commands/instructions.js";
import { infoCommand } from "./commands/info.js";
import { diffCommand } from "./commands/diff.js";
import { editCommand } from "./commands/edit.js";
import { addToCommand } from "./commands/add-to.js";
import { removeFromCommand } from "./commands/remove-from.js";
import { kindsCommand } from "./commands/kinds.js";
import { docsCommand } from "./commands/docs.js";
import { sanitizeCommand } from "./commands/sanitize.js";
import { fallbackCommand } from "./commands/fallback.js";
import { installCommand } from "./commands/install.js";
import { updateCommand } from "./commands/update.js";
import { doctorCommand } from "./commands/doctor.js";
import { runtimeCommand } from "./commands/runtime.js";

// ---------------------------------------------------------------------------
// Command groups — controls help output order and section headers
// ---------------------------------------------------------------------------
const COMMAND_GROUPS: Array<{ title: string; commands: Command[] }> = [
  {
    title: "Active Configuration",
    commands: [
      infoCommand,
      runtimeCommand,
      activateCommand,
      deactivateCommand,
      clearCommand,
      statusCommand,
      syncCommand,
      sanitizeCommand,
    ],
  },
  {
    title: "Bundle Management",
    commands: [
      initCommand,
      installCommand,
      createCommand,
      addToCommand,
      removeFromCommand,
      editCommand,
      removeCommand,
      listCommand,
      checkCommand,
      doctorCommand,
      diffCommand,
      fallbackCommand,
    ],
  },
  {
    title: "Artifact Authoring",
    commands: [
      ruleCommand,
      skillCommand,
      instructionsCommand,
      kindsCommand,
    ],
  },
  {
    title: "Help",
    commands: [
      docsCommand,
      updateCommand,
    ],
  },
];

export const cli = new Command()
  .name("loadouts")
  .description("Composable configuration bundles for AI coding agents")
  .version(pkg.version);

for (const group of COMMAND_GROUPS) {
  for (const cmd of group.commands) {
    cli.addCommand(cmd);
  }
}

// ---------------------------------------------------------------------------
// Custom help formatter — renders commands in labeled sections
// ---------------------------------------------------------------------------
cli.configureHelp({
  formatHelp(cmd: Command, helper: Help): string {
    const helpWidth = (helper.helpWidth as number) || 80;
    const indent = 2;
    const sep = 2;

    // Parse command term into parts: { term, alias, args }
    function parseTerm(rawTerm: string): { term: string; alias: string; args: string } {
      const clean = rawTerm.replace(/\s*\[options\]/, "");
      const match = clean.match(/^([a-z-]+)(?:\|([a-z]+))?(.*)?$/i);
      if (match) {
        return { term: match[1], alias: match[2] || "", args: match[3] || "" };
      }
      return { term: clean, alias: "", args: "" };
    }

    // Calculate column widths for a group
    function calcWidths(cmds: Command[]): { termWidth: number; aliasWidth: number } {
      let termWidth = 0;
      let aliasWidth = 0;
      for (const c of cmds) {
        const { term, alias, args } = parseTerm(helper.subcommandTerm(c));
        termWidth = Math.max(termWidth, (term + args).length);
        aliasWidth = Math.max(aliasWidth, alias.length);
      }
      return { termWidth, aliasWidth };
    }

    function formatList(items: string[]): string {
      return items.join("\n").replace(/^/gm, " ".repeat(indent));
    }

    let output: string[] = [`Usage: ${helper.commandUsage(cmd)}`, ""];

    const desc = helper.commandDescription(cmd);
    if (desc) output = output.concat([helper.wrap(desc, helpWidth, 0), ""]);

    const visibleCmds = helper.visibleCommands(cmd);

    for (const group of COMMAND_GROUPS) {
      const groupNames = new Set(group.commands.map((c) => c.name()));
      const groupCmds = visibleCmds.filter((c) => groupNames.has(c.name()));

      if (groupCmds.length === 0) continue;

      const { termWidth, aliasWidth } = calcWidths(groupCmds);

      const items = groupCmds.map((c) => {
        const { term, alias, args } = parseTerm(helper.subcommandTerm(c));
        const termPart = (term + args).padEnd(termWidth);
        const aliasPart = alias
          ? chalk.dim(alias.padStart(aliasWidth))
          : " ".repeat(aliasWidth);
        const descPart = helper.subcommandDescription(c);
        const fullText = `${termPart}  ${aliasPart}  ${descPart}`;
        const wrapIndent = termWidth + sep + aliasWidth + sep;
        return helper.wrap(fullText, helpWidth - indent, wrapIndent);
      });

      output = output.concat([`${group.title}:`, formatList(items), ""]);
    }

    // Options (at the bottom — commands are the primary interface)
    const termWidth = helper.padWidth(cmd, helper);
    const optionList = helper.visibleOptions(cmd).map((opt) => {
      const term = helper.optionTerm(opt);
      const desc = helper.optionDescription(opt);
      if (desc) {
        const fullText = `${term.padEnd(termWidth + sep)}${desc}`;
        return helper.wrap(fullText, helpWidth - indent, termWidth + sep);
      }
      return term;
    });
    if (optionList.length > 0) {
      output = output.concat(["Options:", formatList(optionList), ""]);
    }

    return output.join("\n");
  },
});
