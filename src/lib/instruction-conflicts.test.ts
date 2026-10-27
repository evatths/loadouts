import { describe, it, expect } from "vitest";
import { formatConflictReport } from "./instruction-conflicts.js";
import type { InstructionConflict } from "../core/instructions.js";

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("formatConflictReport", () => {
  it("returns no lines for no conflicts", () => {
    expect(formatConflictReport([])).toEqual([]);
  });

  it("names the owning loadout and shows the added line", () => {
    const conflicts: InstructionConflict[] = [
      {
        path: "/proj/AGENTS.md",
        displayPath: "AGENTS.md",
        reason: "edited",
        edits: [
          {
            owner: {
              loadout: "base",
              displayPath: ".loadouts/instructions/AGENTS.base.md",
              sourcePath: "/proj/.loadouts/instructions/AGENTS.base.md",
            },
            before: "line one\nline two\n",
            after: "line one\nline two\nline three\n",
          },
          { owner: null, before: "", after: "stray\n" },
        ],
      },
    ];

    const report = formatConflictReport(conflicts).map(strip);

    expect(report[0]).toBe("! AGENTS.md has local edits — not overwritten.");
    expect(report).toContain("  from base (.loadouts/instructions/AGENTS.base.md):");
    expect(report).toContain("  outside loadouts sections:");
    expect(report.some((l) => l.trim() === "+line three")).toBe(true);
    expect(report.some((l) => l.includes("+++") || l.includes("==="))).toBe(false);
    expect(report.at(-1)).toContain("loadouts sync --force");
  });
});
