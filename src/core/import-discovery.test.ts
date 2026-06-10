import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverImportableArtifacts } from "./import-discovery.js";
import { registry } from "./registry.js";
import { createPluginAPI } from "./plugin.js";
import { registerBuiltins } from "../builtins/index.js";

const FIXTURES_DIR = path.join(process.cwd(), "test-fixtures", "import-discovery");
const CUSTOM_KIND_ID = "test.import-snippet";
const CUSTOM_TOOL = "testscope";

function setupFixture(structure: Record<string, string | null>): void {
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }

  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(FIXTURES_DIR, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (content !== null) {
      fs.writeFileSync(fullPath, content);
    }
  }
}

function cleanupFixture(): void {
  if (fs.existsSync(FIXTURES_DIR)) {
    fs.rmSync(FIXTURES_DIR, { recursive: true, force: true });
  }
}

describe("discoverImportableArtifacts", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }

    if (!registry.getKind(CUSTOM_KIND_ID)) {
      registry.registerKind({
        id: CUSTOM_KIND_ID,
        description: "Test import snippets",
        layout: "file",
        detect: (rel) => rel.startsWith("snippets/") && rel.endsWith(".txt"),
        defaultTargets: {
          opencode: { path: "{base}/snippets/{stem}.txt" },
        },
      });
    }

    if (!registry.getTool(CUSTOM_TOOL)) {
      registry.registerTool({
        name: CUSTOM_TOOL,
        basePath: {
          project: ".testscope",
          global: ".testscope-global",
        },
        supports: [CUSTOM_KIND_ID],
        targets: {
          [CUSTOM_KIND_ID]: { path: "{base}/snippets/{stem}.txt" },
        },
      });
    }
  });

  beforeEach(() => {
    cleanupFixture();
  });

  afterEach(() => {
    cleanupFixture();
  });

  it("discovers built-in OpenCode artifacts via templates", () => {
    setupFixture({
      "project/opencode.jsonc": '{"$schema":"https://opencode.ai/config.json"}\n',
      "project/.opencode/plugins/notify.ts": "export default {};\n",
      "project/.opencode/commands/loadouts.md": "# Loadouts command\n",
    });

    const projectRoot = path.join(FIXTURES_DIR, "project");
    const result = discoverImportableArtifacts(projectRoot, {
      tools: ["opencode"],
      kinds: ["opencode-config", "opencode-plugin", "opencode-command"],
    });

    expect(result.warnings).toEqual([]);
    expect(result.artifacts).toHaveLength(3);
    expect(result.artifacts.map((a) => a.destPath).sort()).toEqual([
      "opencode/commands/loadouts.md",
      "opencode/opencode.jsonc",
      "opencode/plugins/notify.ts",
    ]);
  });

  it("discovers custom registered kinds through registry mappings", () => {
    setupFixture({
      "project/.opencode/snippets/hello.txt": "hello\n",
    });

    const projectRoot = path.join(FIXTURES_DIR, "project");
    const result = discoverImportableArtifacts(projectRoot, {
      tools: ["opencode"],
      kinds: [CUSTOM_KIND_ID],
    });

    expect(result.warnings).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].kind).toBe(CUSTOM_KIND_ID);
    expect(result.artifacts[0].destPath).toBe("snippets/hello.txt");
  });

  it("filters already-imported custom artifacts when loadout path is provided", () => {
    setupFixture({
      "project/.opencode/snippets/hello.txt": "hello\n",
      "project/.loadouts/snippets/hello.txt": "hello\n",
    });

    const projectRoot = path.join(FIXTURES_DIR, "project");
    const loadoutPath = path.join(projectRoot, ".loadouts");
    const result = discoverImportableArtifacts(projectRoot, {
      tools: ["opencode"],
      kinds: [CUSTOM_KIND_ID],
      loadoutPath,
    });

    expect(result.artifacts).toHaveLength(0);
  });

  it("discovers global-scope artifacts using the same registry logic", () => {
    setupFixture({
      "home/.testscope-global/snippets/global.txt": "global\n",
    });

    const homeRoot = path.join(FIXTURES_DIR, "home");
    const result = discoverImportableArtifacts(homeRoot, {
      scope: "global",
      tools: [CUSTOM_TOOL],
      kinds: [CUSTOM_KIND_ID],
    });

    expect(result.warnings).toEqual([]);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].displayPath).toBe(".testscope-global/snippets/global.txt");
    expect(result.artifacts[0].destPath).toBe("snippets/global.txt");
  });

  it("restricts discovery to an explicit source directory", () => {
    setupFixture({
      "project/.cursor/rules/one.mdc": "# One\n",
      "project/.cursor/rules/two.mdc": "# Two\n",
    });

    const projectRoot = path.join(FIXTURES_DIR, "project");
    const sourcePath = path.join(projectRoot, ".cursor", "rules", "one.mdc");
    const result = discoverImportableArtifacts(projectRoot, {
      tools: ["cursor"],
      kinds: ["rule"],
      sourcePath,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].sourcePath).toBe(sourcePath);
    expect(result.artifacts[0].destPath).toBe("rules/one.md");
  });

  it("discovers canonical source layouts outside tool directories", () => {
    setupFixture({
      "package/rules/review.md": "# Review\n",
      "package/skills/debug/SKILL.md": "---\ndescription: Debug\n---\n# Debug\n",
      "package/instructions/AGENTS.backend.md": "# Backend\n",
    });

    const sourceRoot = path.join(FIXTURES_DIR, "package");
    const result = discoverImportableArtifacts(sourceRoot, {
      kinds: ["rule", "skill", "instruction"],
      sourcePath: sourceRoot,
    });

    expect(result.artifacts.map((a) => a.destPath).sort()).toEqual([
      "instructions/AGENTS.base.md",
      "rules/review.md",
      "skills/debug",
    ]);
    expect(result.artifacts.every((a) => a.tool === "source")).toBe(true);
  });

  it("discovers a direct skill directory source", () => {
    setupFixture({
      "downloaded/debug/SKILL.md": "---\ndescription: Debug\n---\n# Debug\n",
      "downloaded/debug/script.sh": "#!/bin/sh\n",
    });

    const sourcePath = path.join(FIXTURES_DIR, "downloaded", "debug");
    const result = discoverImportableArtifacts(sourcePath, {
      kinds: ["skill"],
      sourcePath,
    });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].kind).toBe("skill");
    expect(result.artifacts[0].destPath).toBe("skills/debug");
  });
});
