import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { saveState } from "../../core/manifest.js";
import { hashContent } from "../../lib/fs.js";
import { compileSession } from "./delta.js";

registerBuiltins(createPluginAPI(registry));
const dirs: string[] = [];
afterEach(() => { for (const directory of dirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("session instruction delta", () => {
  it("excludes intact managed outputs but includes drifted, shadowed, and other-tool sources", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-delta-")); dirs.push(directory);
    const root = path.join(directory, ".loadouts");
    fs.mkdirSync(path.join(root, "loadouts"), { recursive: true });
    fs.mkdirSync(path.join(root, "instructions"), { recursive: true });
    const source = path.join(root, "instructions/AGENTS.base.md");
    const target = path.join(directory, "AGENTS.md");
    const content = "Already on disk.\n";
    fs.writeFileSync(source, content);
    fs.symlinkSync(source, target);
    fs.writeFileSync(path.join(root, "loadouts/base.yaml"), "name: base\ntools: [opencode]\ninclude: [instructions/AGENTS.base.md]\n");
    const state = { active: ["base"], appliedAt: new Date().toISOString(), mode: "symlink" as const,
      entries: [{ kind: "instruction", tools: ["opencode"], sourcePath: source, targetPath: "AGENTS.md", mode: "symlink" as const, renderedHash: hashContent(content) }], shadowed: [] };
    saveState(root, state);
    expect((await compileSession(directory, ["base"], { scope: "project" })).entries).toEqual({});
    expect(Object.values((await compileSession(directory, ["base"], { scope: "project", excludeOnDisk: false })).entries).join()).toContain(content);
    fs.writeFileSync(source, "Updated through the live symlink.\n");
    expect((await compileSession(directory, ["base"], { scope: "project" })).entries).toEqual({});
    fs.writeFileSync(source, content);
    fs.unlinkSync(target);
    expect(Object.values((await compileSession(directory, ["base"], { scope: "project" })).entries).join()).toContain(content);
    fs.symlinkSync(source, target);
    state.entries[0].tools = ["codex"];
    saveState(root, state);
    expect(Object.values((await compileSession(directory, ["base"], { scope: "project" })).entries).join()).toContain(content);
  });
});
