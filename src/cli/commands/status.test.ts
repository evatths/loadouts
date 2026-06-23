import { afterEach, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";
import { registerBuiltins } from "../../builtins/index.js";
import { createPluginAPI } from "../../core/plugin.js";
import { registry } from "../../core/registry.js";
import { resolveContexts } from "../../core/scope.js";
import { getStatusJson } from "./status.js";

let tempDir: string | undefined;

function setupProject(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadouts-status-json-"));
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
  fs.writeFileSync(
    path.join(loadoutRoot, ".state.json"),
    JSON.stringify({ active: ["base"], mode: "symlink", appliedAt: new Date().toISOString(), entries: [] }),
    "utf-8"
  );
  return projectRoot;
}

describe("status --json", () => {
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

  it("returns parseable JSON with active and drift keys", async () => {
    const projectRoot = setupProject();
    const { contexts } = await resolveContexts({ local: true }, projectRoot);
    const payload = await getStatusJson(contexts, projectRoot);
    const parsed = JSON.parse(JSON.stringify(payload));

    expect(Array.isArray(parsed.active)).toBe(true);
    expect(Array.isArray(parsed.drift)).toBe(true);
    expect(parsed.active).toContain("base");
    expect(parsed.drift[0]).toMatchObject({ name: "base" });
    expect(parsed.drift[0]).toHaveProperty("kind");
    expect(parsed.drift[0]).toHaveProperty("path");
    expect(parsed.drift[0]).toHaveProperty("reason");
  });
});
