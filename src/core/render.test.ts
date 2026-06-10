import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyPlan, applyMultiPlan, planRender, removeManaged } from "./render.js";
import { detectDrift, loadState } from "./manifest.js";
import { hashContent } from "../lib/fs.js";
import { resolveLoadout } from "./resolve.js";
import { getBundledRoot } from "./discovery.js";
import { registry } from "./registry.js";
import { createPluginAPI } from "./plugin.js";
import { registerBuiltins } from "../builtins/index.js";
import type { LoadoutRoot, RenderPlan, ResolvedItem, ResolvedLoadout } from "./types.js";

interface SymlinkFixture {
  tmpDir: string;
  projectRoot: string;
  loadoutRoot: string;
  sourcePath: string;
  baseLink: string;
  dotfilesBase: string;
}

const TARGET_PATH = ".opencode/skills/grill-me/SKILL.md";

function createFixture(): SymlinkFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-render-test-"));
  const projectRoot = path.join(tmpDir, "project");
  const loadoutRoot = path.join(projectRoot, ".loadouts");
  const sourcePath = path.join(tmpDir, "source", "SKILL.md");
  const baseLink = path.join(projectRoot, ".opencode");
  const dotfilesBase = path.join(tmpDir, "dotfiles", "opencode");

  fs.mkdirSync(loadoutRoot, { recursive: true });
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.mkdirSync(dotfilesBase, { recursive: true });

  fs.writeFileSync(sourcePath, "# Grill me\n", "utf-8");
  fs.writeFileSync(path.join(dotfilesBase, "opencode.jsonc"), "{}\n", "utf-8");
  fs.symlinkSync(dotfilesBase, baseLink, "dir");

  return { tmpDir, projectRoot, loadoutRoot, sourcePath, baseLink, dotfilesBase };
}

function createLoadoutAndPlan(
  sourcePath: string,
  loadoutRoot: string
): { loadout: ResolvedLoadout; plan: RenderPlan } {
  const item: ResolvedItem = {
    kind: "skill",
    sourcePath,
    relativePath: "skills/grill-me/SKILL.md",
    tools: ["opencode"],
  };

  const plan: RenderPlan = {
    outputs: [
      {
        spec: {
          tool: "opencode",
          kind: "skill",
          sourcePath,
          targetPath: TARGET_PATH,
          mode: "symlink",
        },
        item,
        hash: hashContent(fs.readFileSync(sourcePath, "utf-8")),
      },
    ],
    errors: [],
    shadowed: [],
  };

  const loadout: ResolvedLoadout = {
    name: "test",
    description: "",
    tools: ["opencode"],
    items: [item],
    rootPath: loadoutRoot,
  };

  return { loadout, plan };
}

describe("render symlinked base path safety", () => {
  let fixture: SymlinkFixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
  });

  it("applyPlan preserves symlinked base path and writes through it", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");
    await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");

    expect(fs.lstatSync(fixture.baseLink).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(fixture.baseLink, "opencode.jsonc"))).toBe(true);

    const outputPath = path.join(fixture.projectRoot, TARGET_PATH);
    expect(fs.lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(
      fs.existsSync(path.join(fixture.dotfilesBase, "skills", "grill-me", "SKILL.md"))
    ).toBe(true);
  });

  it("applyMultiPlan preserves symlinked base path and stays idempotent", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    await applyMultiPlan(
      [{ loadout, plan }],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    const second = await applyMultiPlan(
      [{ loadout, plan }],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    expect(fs.lstatSync(fixture.baseLink).isSymbolicLink()).toBe(true);
    expect(second.changes.added).toHaveLength(0);
    expect(second.changes.updated).toHaveLength(0);
  });

  it("applyMultiPlan removes empty parent directories for deactivated outputs", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    const secondSourcePath = path.join(fixture.tmpDir, "source", "SECOND_SKILL.md");
    fs.writeFileSync(secondSourcePath, "# Diagnose\n", "utf-8");

    const secondItem: ResolvedItem = {
      kind: "skill",
      sourcePath: secondSourcePath,
      relativePath: "skills/diagnose/SKILL.md",
      tools: ["opencode"],
    };

    const secondTargetPath = ".opencode/skills/diagnose/SKILL.md";
    const secondPlan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "skill",
            sourcePath: secondSourcePath,
            targetPath: secondTargetPath,
            mode: "symlink",
          },
          item: secondItem,
          hash: hashContent(fs.readFileSync(secondSourcePath, "utf-8")),
        },
      ],
      errors: [],
      shadowed: [],
    };

    const secondLoadout: ResolvedLoadout = {
      name: "diagnose",
      description: "",
      tools: ["opencode"],
      items: [secondItem],
      rootPath: fixture.loadoutRoot,
    };

    await applyMultiPlan(
      [
        { loadout, plan },
        { loadout: secondLoadout, plan: secondPlan },
      ],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    await applyMultiPlan(
      [{ loadout: secondLoadout, plan: secondPlan }],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".opencode/skills/grill-me"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(fixture.projectRoot, secondTargetPath))
    ).toBe(true);
  });

  it("applyMultiPlan keeps non-empty parent directories when removing outputs", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    const secondSourcePath = path.join(fixture.tmpDir, "source", "SECOND_SKILL.md");
    fs.writeFileSync(secondSourcePath, "# Diagnose\n", "utf-8");

    const secondItem: ResolvedItem = {
      kind: "skill",
      sourcePath: secondSourcePath,
      relativePath: "skills/diagnose/SKILL.md",
      tools: ["opencode"],
    };

    const secondTargetPath = ".opencode/skills/diagnose/SKILL.md";
    const secondPlan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "skill",
            sourcePath: secondSourcePath,
            targetPath: secondTargetPath,
            mode: "symlink",
          },
          item: secondItem,
          hash: hashContent(fs.readFileSync(secondSourcePath, "utf-8")),
        },
      ],
      errors: [],
      shadowed: [],
    };

    const secondLoadout: ResolvedLoadout = {
      name: "diagnose",
      description: "",
      tools: ["opencode"],
      items: [secondItem],
      rootPath: fixture.loadoutRoot,
    };

    await applyMultiPlan(
      [
        { loadout, plan },
        { loadout: secondLoadout, plan: secondPlan },
      ],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    const unmanagedFile = path.join(
      fixture.projectRoot,
      ".opencode/skills/grill-me/NOTES.md"
    );
    fs.writeFileSync(unmanagedFile, "keep me\n", "utf-8");

    await applyMultiPlan(
      [{ loadout: secondLoadout, plan: secondPlan }],
      fixture.loadoutRoot,
      fixture.projectRoot,
      "symlink",
      "project"
    );

    expect(
      fs.existsSync(path.join(fixture.projectRoot, ".opencode/skills/grill-me"))
    ).toBe(true);
    expect(fs.existsSync(unmanagedFile)).toBe(true);
  });

  it("removeManaged removes managed outputs but keeps base symlink and config", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");
    const result = await removeManaged(
      fixture.loadoutRoot,
      fixture.projectRoot,
      "project"
    );

    expect(result.removed).toContain(TARGET_PATH);
    expect(fs.existsSync(path.join(fixture.projectRoot, TARGET_PATH))).toBe(false);
    expect(fs.lstatSync(fixture.baseLink).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(fixture.baseLink, "opencode.jsonc"))).toBe(true);
  });

  it("detectDrift treats outputs under symlinked parents as ok", async () => {
    const { loadout, plan } = createLoadoutAndPlan(
      fixture.sourcePath,
      fixture.loadoutRoot
    );

    await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");

    const state = loadState(fixture.loadoutRoot);
    expect(state).not.toBeNull();

    const drift = detectDrift(state!, fixture.projectRoot);
    expect(drift).toHaveLength(1);
    expect(drift[0].status).toBe("ok");
  });
});

describe("render OpenCode-specific artifacts", () => {
  let tmpDir: string;
  let projectRoot: string;
  let loadoutRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-opencode-test-"));
    projectRoot = path.join(tmpDir, "project");
    loadoutRoot = path.join(projectRoot, ".loadouts");
    fs.mkdirSync(loadoutRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders a local OpenCode plugin into .opencode/plugins", async () => {
    const sourcePath = path.join(loadoutRoot, "opencode", "plugins", "notify.ts");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "export const Notify = async () => ({})\n", "utf-8");

    const item: ResolvedItem = {
      kind: "opencode-plugin",
      sourcePath,
      relativePath: "opencode/plugins/notify.ts",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-plugin",
            sourcePath,
            targetPath: ".opencode/plugins/notify.ts",
            mode: "symlink",
          },
          item,
          hash: hashContent(fs.readFileSync(sourcePath, "utf-8")),
        },
      ],
      errors: [],
      shadowed: [],
    };
    const loadout: ResolvedLoadout = {
      name: "test",
      description: "",
      tools: ["opencode"],
      items: [item],
      rootPath: loadoutRoot,
    };

    await applyPlan(plan, loadout, projectRoot, "symlink", "project");

    const outputPath = path.join(projectRoot, ".opencode/plugins/notify.ts");
    expect(fs.lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(outputPath)).toBe(fs.realpathSync(sourcePath));
  });

  it("renders whole-file OpenCode config to the project root", async () => {
    const sourcePath = path.join(loadoutRoot, "opencode", "opencode.jsonc");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(
      sourcePath,
      '{ "$schema": "https://opencode.ai/config.json", "plugin": [] }\n',
      "utf-8"
    );

    const item: ResolvedItem = {
      kind: "opencode-config",
      sourcePath,
      relativePath: "opencode/opencode.jsonc",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-config",
            sourcePath,
            targetPath: "opencode.jsonc",
            mode: "symlink",
          },
          item,
          hash: hashContent(fs.readFileSync(sourcePath, "utf-8")),
        },
      ],
      errors: [],
      shadowed: [],
    };
    const loadout: ResolvedLoadout = {
      name: "test",
      description: "",
      tools: ["opencode"],
      items: [item],
      rootPath: loadoutRoot,
    };

    await applyPlan(plan, loadout, projectRoot, "symlink", "project");

    const outputPath = path.join(projectRoot, "opencode.jsonc");
    expect(fs.lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(outputPath)).toBe(fs.realpathSync(sourcePath));
  });

  it("renders OpenCode slash commands into .opencode/commands", async () => {
    const sourcePath = path.join(loadoutRoot, "opencode", "commands", "loadouts.md");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "# /loadouts\n", "utf-8");

    const item: ResolvedItem = {
      kind: "opencode-command",
      sourcePath,
      relativePath: "opencode/commands/loadouts.md",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-command",
            sourcePath,
            targetPath: ".opencode/commands/loadouts.md",
            mode: "symlink",
          },
          item,
          hash: hashContent(fs.readFileSync(sourcePath, "utf-8")),
        },
      ],
      errors: [],
      shadowed: [],
    };
    const loadout: ResolvedLoadout = {
      name: "test",
      description: "",
      tools: ["opencode"],
      items: [item],
      rootPath: loadoutRoot,
    };

    await applyPlan(plan, loadout, projectRoot, "symlink", "project");

    const outputPath = path.join(projectRoot, ".opencode/commands/loadouts.md");
    expect(fs.lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(outputPath)).toBe(fs.realpathSync(sourcePath));
  });
});

describe("full render pipeline compatibility", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }
  });

  function createPipelineFixture(structure: Record<string, string>): {
    tmpDir: string;
    projectRoot: string;
    loadoutRoot: string;
  } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-pipeline-test-"));
    const projectRoot = path.join(tmpDir, "project");
    const loadoutRoot = path.join(projectRoot, ".loadouts");

    fs.mkdirSync(loadoutRoot, { recursive: true });

    for (const [relativePath, content] of Object.entries(structure)) {
      const fullPath = path.join(loadoutRoot, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }

    return { tmpDir, projectRoot, loadoutRoot };
  }

  async function renderBaseLoadout(projectRoot: string, loadoutRoot: string): Promise<void> {
    const roots: LoadoutRoot[] = [{ path: loadoutRoot, level: "project", depth: 0 }];
    const loadout = resolveLoadout("base", roots);
    const plan = await planRender(loadout, projectRoot, "project");

    expect(plan.errors).toEqual([]);

    await applyPlan(plan, loadout, projectRoot, "symlink", "project");
  }

  it("renders canonical rules to Cursor with globs/alwaysApply aliases", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - cursor\ninclude:\n  - rules/ts-style.md\n`,
      "rules/ts-style.md": `---\ndescription: TypeScript style\npaths:\n  - \"**/*.ts\"\nactivation: scoped\n---\n\n# TypeScript Style\n`,
    });

    try {
      await renderBaseLoadout(fixture.projectRoot, fixture.loadoutRoot);

      const outputPath = path.join(
        fixture.projectRoot,
        ".cursor/rules/ts-style.mdc"
      );
      const rendered = fs.readFileSync(outputPath, "utf-8");

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(rendered).toContain("paths:");
      expect(rendered).toContain("activation: scoped");
      expect(rendered).toContain("globs:");
      expect(rendered).toContain("alwaysApply: false");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("renders canonical skills to OpenCode with disable-model-invocation alias", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`,
      "skills/debugger/SKILL.md": `---\nname: debugger\ndescription: Debug runtime issues\nuser-invocable: true\nmodel-invocable: false\n---\n\n# Debugger\n`,
    });

    try {
      await renderBaseLoadout(fixture.projectRoot, fixture.loadoutRoot);

      const outputPath = path.join(
        fixture.projectRoot,
        ".opencode/skills/debugger/SKILL.md"
      );
      const rendered = fs.readFileSync(outputPath, "utf-8");

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(rendered).toContain("model-invocable: false");
      expect(rendered).toContain("disable-model-invocation: true");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("renders canonical rules to OpenCode with rule aliases", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - rules/go-style.md\n`,
      "rules/go-style.md": `---\ndescription: Go style\npaths:\n  - \"**/*.go\"\nactivation: always\n---\n\n# Go Style\n`,
    });

    try {
      await renderBaseLoadout(fixture.projectRoot, fixture.loadoutRoot);

      const outputPath = path.join(
        fixture.projectRoot,
        ".opencode/rules/go-style.md"
      );
      const rendered = fs.readFileSync(outputPath, "utf-8");

      expect(fs.existsSync(outputPath)).toBe(true);
      expect(rendered).toContain("globs:");
      expect(rendered).toContain("alwaysApply: true");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("renders bundled OpenCode runtime plugin artifact", async () => {
    const fixture = createPipelineFixture({});
    const bundledRoot = getBundledRoot();
    expect(bundledRoot).not.toBeNull();

    try {
      const loadout = resolveLoadout("opencode-runtime", [bundledRoot!]);
      const plan = await planRender(loadout, fixture.projectRoot, "project");

      expect(plan.errors).toEqual([]);
      expect(plan.outputs.map((o) => o.spec.targetPath).sort()).toEqual([
        ".opencode/plugins/loadouts-runtime.ts",
      ]);

      // Do not apply a plan with the real bundled root: applyPlan persists
      // state beside the loadout root, and bundled assets are package data.
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });
});
