import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { getDiffJson } from "./diff.js";

let tempDir: string | undefined;

function setupProject(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-diff-json-"));
  const projectRoot = path.join(tempDir, "project");
  const loadoutRoot = path.join(projectRoot, ".loadouts");
  fs.mkdirSync(path.join(loadoutRoot, "loadouts"), { recursive: true });
  fs.mkdirSync(path.join(loadoutRoot, "rules"), { recursive: true });
  fs.writeFileSync(path.join(loadoutRoot, "loadouts.yaml"), yaml.stringify({ version: "1" }));
  fs.writeFileSync(
    path.join(loadoutRoot, "loadouts", "base.yaml"),
    yaml.stringify({ name: "base", include: ["rules/base.md"] })
  );
  fs.writeFileSync(path.join(loadoutRoot, "rules", "base.md"), "# Base rule\n", "utf-8");
  return projectRoot;
}

describe("diff --json", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("returns parseable JSON with changes key", async () => {
    const projectRoot = setupProject();
    const payload = await getDiffJson("base", { local: true }, projectRoot);
    const parsed = JSON.parse(JSON.stringify(payload));

    expect(Array.isArray(parsed.changes)).toBe(true);
    expect(parsed.changes.length).toBeGreaterThan(0);
    expect(parsed.changes[0]).toHaveProperty("tool");
    expect(parsed.changes[0]).toHaveProperty("path");
    expect(parsed.changes[0]).toHaveProperty("op");
  });
});
