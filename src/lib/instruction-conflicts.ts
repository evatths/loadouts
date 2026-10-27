/**
 * Held-edit report for composed instructions (CLI only).
 *
 * Renders the per-section diffs that explain why a generated instruction file
 * was left alone. Lives here, not in core, so `diff` and chalk stay out of the
 * TUI hosts and the bundled runtimes.
 */

import chalk from "chalk";
import { createPatch } from "diff";
import type { InstructionConflict } from "../core/instructions.js";

const FOOTER =
  "Move these edits into the source file(s) above and run `loadouts sync`, " +
  "or discard them with `loadouts sync --force` (backup: .loadouts/AGENTS.loadouts-generated.md.bak).";

function patchBody(before: string, after: string): string[] {
  const patch = createPatch("section", before, after, "", "", { context: 2 });
  return patch
    .split("\n")
    // Section bodies are trimmed, so "\ No newline at end of file" is always noise.
    .filter((line) => !/^(Index:|={5,}|--- |\+\+\+ |\\ No newline)/.test(line))
    .filter((line, i, all) => line !== "" || i < all.length - 1)
    .map((line) => {
      if (line.startsWith("+")) return chalk.green(line);
      if (line.startsWith("-")) return chalk.red(line);
      return line;
    });
}

export function formatConflictReport(conflicts: InstructionConflict[]): string[] {
  if (conflicts.length === 0) return [];

  const lines: string[] = [];
  for (const conflict of conflicts) {
    lines.push(`! ${conflict.displayPath} has local edits — not overwritten.`);
    for (const edit of conflict.edits) {
      lines.push(
        edit.owner
          ? `  from ${edit.owner.loadout} (${edit.owner.displayPath}):`
          : "  outside loadouts sections:"
      );
      for (const line of patchBody(edit.before, edit.after)) lines.push(`    ${line}`);
    }
  }
  lines.push("", FOOTER);
  return lines;
}
