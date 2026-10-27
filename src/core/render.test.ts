import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyPlan, applyMultiPlan, planRender, removeManaged, resolveOutputSpec } from "./render.js";
import { detectDrift, entrySources, expandDriftBySource, loadState } from "./manifest.js";
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
    const sourcePath = path.join(loadoutRoot, "opencode", "plugins", "notify.tsx");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, "export const Notify = async () => ({})\n", "utf-8");

    const item: ResolvedItem = {
      kind: "opencode-plugin",
      sourcePath,
      relativePath: "opencode/plugins/notify.tsx",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-plugin",
            sourcePath,
            targetPath: ".opencode/plugins/notify.tsx",
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

    const outputPath = path.join(projectRoot, ".opencode/plugins/notify.tsx");
    expect(fs.lstatSync(outputPath).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(outputPath)).toBe(fs.realpathSync(sourcePath));
  });

  it("renders whole-file OpenCode CLI config under .opencode", async () => {
    const sourcePath = path.join(loadoutRoot, "opencode", "cli.jsonc");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(
      sourcePath,
      '{ "$schema": "https://opencode.ai/v2/cli.json", "plugins": [] }\n',
      "utf-8"
    );

    const item: ResolvedItem = {
      kind: "opencode-cli-config",
      sourcePath,
      relativePath: "opencode/cli.jsonc",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-cli-config",
            sourcePath,
            targetPath: ".opencode/cli.jsonc",
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

    const outputPath = path.join(projectRoot, ".opencode/cli.jsonc");
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

  it("does not resolve an output spec for OpenCode CLI config at project scope (global-only)", () => {
    const item: ResolvedItem = {
      kind: "opencode-cli-config",
      sourcePath: "/unused/absolute/source/path/cli.jsonc",
      relativePath: "opencode/cli.jsonc",
      tools: ["opencode"],
    };

    expect(resolveOutputSpec("opencode", item, "project")).toBeNull();
    expect(resolveOutputSpec("opencode", item, "global")?.targetPath).toMatch(
      /[/\\]\.config[/\\]opencode[/\\]cli\.jsonc$/
    );
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

  it("renders canonical skills to OpenCode with metadata.opencode/autoinvoke alias", async () => {
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
      expect(rendered).toContain("opencode/autoinvoke: false");
      expect(rendered).not.toContain("disable-model-invocation");
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
        ".opencode/plugins/loadouts/index.js",
        ".opencode/plugins/loadouts/package.json",
        ".opencode/plugins/loadouts/tui.js",
      ]);

      // Do not apply a plan with the real bundled root: applyPlan persists
      // state beside the loadout root, and bundled assets are package data.
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("renders self-contained agent files with target-scoped overlays", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\n  - cursor\n  - claude-code\n  - codex\ninclude:\n  - agents/code-reviewer.md\n`,
      "agents/code-reviewer.md": `---\nname: code-reviewer\ndescription: Reviews code for correctness, security, and missing tests.\nmodel: inherit\nreadonly: true\nbackground: true\ntargets:\n  opencode:\n    mode: subagent\n    steps: 8\n    color: accent\n  cursor:\n    model: gpt-5.5\n    is_background: false\n  claude-code:\n    tools: Read, Glob, Grep, Bash\n    maxTurns: 4\n  codex:\n    model_reasoning_effort: high\n---\n\nReview code like an owner.\n`,
    });

    try {
      await renderBaseLoadout(fixture.projectRoot, fixture.loadoutRoot);

      const opencodePath = path.join(
        fixture.projectRoot,
        ".opencode/agents/code-reviewer.md"
      );
      const cursorPath = path.join(
        fixture.projectRoot,
        ".cursor/agents/code-reviewer.md"
      );
      const claudePath = path.join(
        fixture.projectRoot,
        ".claude/agents/code-reviewer.md"
      );
      const codexPath = path.join(
        fixture.projectRoot,
        ".codex/agents/code-reviewer.toml"
      );

      const opencode = fs.readFileSync(opencodePath, "utf-8");
      expect(opencode).toContain("description: Reviews code");
      expect(opencode).toContain("mode: subagent");
      expect(opencode).toContain("steps: 8");
      expect(opencode).toContain("color: accent");
      expect(opencode).toContain("permissions:");
      expect(opencode).toContain('action: edit');
      expect(opencode).toContain('resource: "*"');
      expect(opencode).toContain("effect: deny");
      expect(opencode).not.toContain("permission:");
      expect(opencode).not.toContain("targets:");
      expect(opencode).not.toContain("name: code-reviewer");
      expect(opencode).not.toContain("model: inherit");

      const cursor = fs.readFileSync(cursorPath, "utf-8");
      expect(cursor).toContain("name: code-reviewer");
      expect(cursor).toContain("model: gpt-5.5");
      expect(cursor).toContain("readonly: true");
      expect(cursor).toContain("is_background: false");
      expect(cursor).not.toContain("targets:");

      const claude = fs.readFileSync(claudePath, "utf-8");
      expect(claude).toContain("name: code-reviewer");
      expect(claude).toContain("permissionMode: plan");
      expect(claude).toContain("tools: Read, Glob, Grep, Bash");
      expect(claude).toContain("maxTurns: 4");
      expect(claude).not.toContain("targets:");

      const codex = fs.readFileSync(codexPath, "utf-8");
      expect(codex).toContain('name = "code-reviewer"');
      expect(codex).toContain('description = "Reviews code for correctness, security, and missing tests."');
      expect(codex).toContain('sandbox_mode = "read-only"');
      expect(codex).toContain('model_reasoning_effort = "high"');
      expect(codex).toContain('developer_instructions = "Review code like an owner."');
      expect(codex).toContain("Review code like an owner.");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("symlinks Markdown agents when frontmatter is natively safe", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\n  - cursor\n  - claude-code\ninclude:\n  - agents/verifier.md\n`,
      "agents/verifier.md": `---\ndescription: Validates completed work.\n---\n\nVerify claims skeptically.\n`,
    });

    try {
      await renderBaseLoadout(fixture.projectRoot, fixture.loadoutRoot);

      const sourcePath = path.join(fixture.loadoutRoot, "agents/verifier.md");
      const opencodePath = path.join(fixture.projectRoot, ".opencode/agents/verifier.md");
      const cursorPath = path.join(fixture.projectRoot, ".cursor/agents/verifier.md");
      const claudePath = path.join(fixture.projectRoot, ".claude/agents/verifier.md");

      expect(fs.lstatSync(opencodePath).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(opencodePath)).toBe(fs.realpathSync(sourcePath));
      expect(fs.lstatSync(cursorPath).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(cursorPath)).toBe(fs.realpathSync(sourcePath));

      expect(fs.lstatSync(claudePath).isSymbolicLink()).toBe(false);
      const claude = fs.readFileSync(claudePath, "utf-8");
      expect(claude).toContain("name: verifier");
      expect(claude).toContain("description: Validates completed work.");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("adopts unmanaged file that is already a symlink to the source", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`,
      "skills/debugger/SKILL.md": `---\nname: debugger\ndescription: Debug issues\n---\n\n# Debugger\n`,
    });

    try {
      const sourcePath = path.join(fixture.loadoutRoot, "skills/debugger/SKILL.md");
      const outputPath = path.join(
        fixture.projectRoot,
        ".opencode/skills/debugger/SKILL.md"
      );

      // Pre-create an unmanaged symlink to the source (simulates a manually
      // placed symlink that loadouts doesn't own yet).
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.symlinkSync(sourcePath, outputPath, "file");

      const roots: LoadoutRoot[] = [{ path: fixture.loadoutRoot, level: "project", depth: 0 }];
      const loadout = resolveLoadout("base", roots);
      const plan = await planRender(loadout, fixture.projectRoot, "project");

      expect(plan.errors).toEqual([]);
      expect(plan.shadowed).toEqual([]);
      expect(plan.outputs.some((o) => o.spec.targetPath === ".opencode/skills/debugger/SKILL.md")).toBe(true);
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("adopts unmanaged file with identical content to the rendered output", async () => {
    const sourceContent = `---\nname: debugger\ndescription: Debug issues\n---\n\n# Debugger\n`;
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`,
      "skills/debugger/SKILL.md": sourceContent,
    });

    try {
      const outputPath = path.join(
        fixture.projectRoot,
        ".opencode/skills/debugger/SKILL.md"
      );

      // Pre-create an unmanaged regular file with identical content.
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, sourceContent, "utf-8");

      const roots: LoadoutRoot[] = [{ path: fixture.loadoutRoot, level: "project", depth: 0 }];
      const loadout = resolveLoadout("base", roots);
      const plan = await planRender(loadout, fixture.projectRoot, "project");

      expect(plan.errors).toEqual([]);
      expect(plan.shadowed).toEqual([]);
      expect(plan.outputs.some((o) => o.spec.targetPath === ".opencode/skills/debugger/SKILL.md")).toBe(true);
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("shadows unmanaged file with differing content", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`,
      "skills/debugger/SKILL.md": `---\nname: debugger\ndescription: Debug issues\n---\n\n# Debugger\n`,
    });

    try {
      const outputPath = path.join(
        fixture.projectRoot,
        ".opencode/skills/debugger/SKILL.md"
      );

      // Pre-create an unmanaged file with DIFFERENT content.
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, "# my custom debugger\n", "utf-8");

      const roots: LoadoutRoot[] = [{ path: fixture.loadoutRoot, level: "project", depth: 0 }];
      const loadout = resolveLoadout("base", roots);
      const plan = await planRender(loadout, fixture.projectRoot, "project");

      expect(plan.errors).toEqual([]);
      expect(plan.shadowed.length).toBe(1);
      expect(plan.shadowed[0].targetPath).toBe(".opencode/skills/debugger/SKILL.md");
      expect(plan.outputs.some((o) => o.spec.targetPath === ".opencode/skills/debugger/SKILL.md")).toBe(false);
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });
});

describe("gitignore freshness on render/remove", () => {
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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-gitignore-render-"));
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

  function planBase(
    projectRoot: string,
    loadoutRoot: string
  ): Promise<{ loadout: ReturnType<typeof resolveLoadout>; plan: ReturnType<typeof planRender> extends Promise<infer P> ? P : never }> {
    const roots: LoadoutRoot[] = [{ path: loadoutRoot, level: "project", depth: 0 }];
    const loadout = resolveLoadout("base", roots);
    return planRender(loadout, projectRoot, "project").then((plan) => ({ loadout, plan }));
  }

  const RULE_YAML = `---\ndescription: TypeScript style\npaths:\n  - "**/*.ts"\nactivation: scoped\n---\n\n# TypeScript Style\n`;

  it("applyPlan writes managed gitignore entries for rendered artifacts", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - cursor\ninclude:\n  - rules/ts-style.md\n`,
      "rules/ts-style.md": RULE_YAML,
    });

    try {
      const { loadout, plan } = await planBase(fixture.projectRoot, fixture.loadoutRoot);
      await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");

      const cursorGitignore = fs.readFileSync(
        path.join(fixture.projectRoot, ".cursor", ".gitignore"),
        "utf-8"
      );
      expect(cursorGitignore).toContain("# <loadouts>");
      expect(cursorGitignore).toContain("rules/ts-style.mdc");

      const loadoutsGitignore = fs.readFileSync(
        path.join(fixture.loadoutRoot, ".gitignore"),
        "utf-8"
      );
      expect(loadoutsGitignore).toContain(".state.json");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("applyMultiPlan writes managed gitignore entries for rendered artifacts", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`,
      "skills/debugger/SKILL.md": `---\nname: debugger\ndescription: Debug issues\n---\n\n# Debugger\n`,
    });

    try {
      const { loadout, plan } = await planBase(fixture.projectRoot, fixture.loadoutRoot);
      await applyMultiPlan(
        [{ loadout, plan }],
        fixture.loadoutRoot,
        fixture.projectRoot,
        "symlink",
        "project"
      );

      const opencodeGitignore = fs.readFileSync(
        path.join(fixture.projectRoot, ".opencode", ".gitignore"),
        "utf-8"
      );
      expect(opencodeGitignore).toContain("# <loadouts>");
      // Dir-layout skills get a trailing slash
      expect(opencodeGitignore).toContain("skills/debugger/");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("re-applying after a definition is deleted prunes its stale gitignore entry", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - cursor\ninclude:\n  - rules/ts-style.md\n  - rules/go-style.md\n`,
      "rules/ts-style.md": RULE_YAML,
      "rules/go-style.md": `---\ndescription: Go style\npaths:\n  - "**/*.go"\n---\n\n# Go Style\n`,
    });

    try {
      const first = await planBase(fixture.projectRoot, fixture.loadoutRoot);
      await applyPlan(first.plan, first.loadout, fixture.projectRoot, "symlink", "project");

      const gitignore = () =>
        fs.readFileSync(path.join(fixture.projectRoot, ".cursor", ".gitignore"), "utf-8");

      expect(gitignore()).toContain("rules/ts-style.mdc");
      expect(gitignore()).toContain("rules/go-style.mdc");

      // Delete the definition and drop it from the loadout
      fs.rmSync(path.join(fixture.loadoutRoot, "rules", "ts-style.md"));
      fs.writeFileSync(
        path.join(fixture.loadoutRoot, "loadouts", "base.yaml"),
        `name: base\ntools:\n  - cursor\ninclude:\n  - rules/go-style.md\n`
      );

      const second = await planBase(fixture.projectRoot, fixture.loadoutRoot);
      await applyPlan(second.plan, second.loadout, fixture.projectRoot, "symlink", "project");

      expect(gitignore()).not.toContain("rules/ts-style.mdc");
      expect(gitignore()).toContain("rules/go-style.mdc");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it("removeManaged refreshes gitignore after definitions are deleted", async () => {
    const fixture = createPipelineFixture({
      "loadouts/base.yaml": `name: base\ntools:\n  - cursor\ninclude:\n  - rules/ts-style.md\n`,
      "rules/ts-style.md": RULE_YAML,
    });

    try {
      const { loadout, plan } = await planBase(fixture.projectRoot, fixture.loadoutRoot);
      await applyPlan(plan, loadout, fixture.projectRoot, "symlink", "project");

      // Definition disappears without any loadouts command knowing
      fs.rmSync(path.join(fixture.loadoutRoot, "rules", "ts-style.md"));

      await removeManaged(fixture.loadoutRoot, fixture.projectRoot, "project");

      const gitignorePath = path.join(fixture.projectRoot, ".cursor", ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, "utf-8");
      expect(content).not.toContain("rules/ts-style.mdc");
    } finally {
      fs.rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });
});

describe("instruction composition", () => {
  beforeAll(() => {
    if (registry.allToolNames().length === 0) {
      registerBuiltins(createPluginAPI(registry));
    }
  });

  interface Fixture {
    tmpDir: string;
    projectRoot: string;
    loadoutRoot: string;
    generated: string;
    agents: string;
  }

  const SKILL = `---\nname: debugger\ndescription: Debug issues\n---\n\n# Debugger\n`;
  const BASE_YAML = `name: base\ntools:\n  - claude-code\n  - opencode\n  - codex\n  - cursor\ninclude:\n  - instructions/AGENTS.base.md\n`;
  const PY_YAML = `name: py\ntools:\n  - opencode\ninclude:\n  - instructions/AGENTS.py.md\n  - skills/debugger\n`;

  function createFixture(structure: Record<string, string> = {}): Fixture {
    const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "loadout-compose-")));
    const projectRoot = path.join(tmpDir, "project");
    const loadoutRoot = path.join(projectRoot, ".loadouts");
    const files: Record<string, string> = {
      "loadouts/base.yaml": BASE_YAML,
      "loadouts/py.yaml": PY_YAML,
      "instructions/AGENTS.base.md": "# Base\n",
      "instructions/AGENTS.py.md": "# Python\n",
      "skills/debugger/SKILL.md": SKILL,
      ...structure,
    };
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = path.join(loadoutRoot, relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }
    return {
      tmpDir,
      projectRoot,
      loadoutRoot,
      generated: path.join(loadoutRoot, "AGENTS.loadouts-generated.md"),
      agents: path.join(projectRoot, "AGENTS.md"),
    };
  }

  async function plansFor(fx: Fixture, names: string[]) {
    const roots: LoadoutRoot[] = [{ path: fx.loadoutRoot, level: "project", depth: 0 }];
    const plans = [];
    for (const name of names) {
      const loadout = resolveLoadout(name, roots);
      plans.push({ loadout, plan: await planRender(loadout, fx.projectRoot, "project", fx.loadoutRoot) });
    }
    return plans;
  }

  async function apply(fx: Fixture, names: string[], options?: { force?: boolean }) {
    return applyMultiPlan(await plansFor(fx, names), fx.loadoutRoot, fx.projectRoot, "symlink", "project", options);
  }

  const read = (p: string) => fs.readFileSync(p, "utf-8");
  const cleanup = (fx: Fixture) => fs.rmSync(fx.tmpDir, { recursive: true, force: true });

  it("composes base + py into one generated file that AGENTS.md links to", async () => {
    const fx = createFixture();
    try {
      const result = await apply(fx, ["base", "py"]);

      expect(fs.lstatSync(fx.agents).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(fx.agents)).toBe(fs.realpathSync(fx.generated));
      const content = read(fx.generated);
      expect(content.indexOf("loadouts:begin base")).toBeGreaterThan(-1);
      expect(content.indexOf("loadouts:begin base")).toBeLessThan(content.indexOf("loadouts:begin py"));
      expect(content).toContain("# Base");
      expect(content).toContain("# Python");
      expect(fs.existsSync(path.join(fx.projectRoot, "CLAUDE.md"))).toBe(false);

      const entry = loadState(fx.loadoutRoot)!.entries.find((e) => e.targetPath === "AGENTS.md")!;
      expect(entry.sourcePath).toBe(fx.generated);
      expect(entry.sources).toHaveLength(2);
      expect(entry.tools).toEqual(["claude-code", "codex", "cursor", "opencode"]);
      expect(result.changes.added).toContain(`AGENTS.md\0${path.join(fx.loadoutRoot, "instructions/AGENTS.py.md")}`);
      expect(result.conflicts).toEqual([]);

      // Activating py on top of base: py added, base unchanged
      await apply(fx, ["base"]);
      const second = await apply(fx, ["base", "py"]);
      const baseKey = `AGENTS.md\0${path.join(fx.loadoutRoot, "instructions/AGENTS.base.md")}`;
      const pyKey = `AGENTS.md\0${path.join(fx.loadoutRoot, "instructions/AGENTS.py.md")}`;
      expect(second.changes.added).toContain(pyKey);
      expect(second.changes.added).not.toContain(baseKey);
      expect(second.changes.updated).not.toContain(baseKey);
    } finally {
      cleanup(fx);
    }
  });

  it("still generates the composed file for a single source", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base"]);
      expect(fs.existsSync(fx.generated)).toBe(true);
      expect(fs.realpathSync(fx.agents)).toBe(fs.realpathSync(fx.generated));
      expect(read(fx.generated)).toContain("<!-- loadouts:begin base · .loadouts/instructions/AGENTS.base.md -->");
    } finally {
      cleanup(fx);
    }
  });

  it("holds an edited generated file, still applies other outputs, and force backs it up", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base", "py"]);
      const edited = read(fx.generated).replace("# Python", "# Python (edited)");
      fs.writeFileSync(fx.generated, edited);
      const skillTarget = path.join(fx.projectRoot, ".opencode/skills/debugger/SKILL.md");
      fs.rmSync(skillTarget);

      const result = await apply(fx, ["base", "py"]);
      expect(read(fx.generated)).toBe(edited);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe("edited");
      expect(result.conflicts[0].edits).toHaveLength(1);
      expect(result.conflicts[0].edits[0].owner?.loadout).toBe("py");
      expect(result.conflicts[0].edits[0].before).toBe("# Python");
      expect(result.conflicts[0].edits[0].after).toBe("# Python (edited)");
      expect(result.changes.held).toHaveLength(2);
      expect(fs.existsSync(skillTarget)).toBe(true);

      const forced = await apply(fx, ["base", "py"], { force: true });
      expect(forced.conflicts).toEqual([]);
      expect(read(path.join(fx.loadoutRoot, "AGENTS.loadouts-generated.md.bak"))).toContain("# Python (edited)");
      expect(read(fx.generated)).not.toContain("(edited)");
      expect(forced.warnings.some((w) => w.includes("AGENTS.loadouts-generated.md.bak"))).toBe(true);
    } finally {
      cleanup(fx);
    }
  });

  it("holds an AGENTS.md replaced by an edited file but relinks a byte-identical one", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base"]);
      const composed = read(fx.generated);

      fs.rmSync(fx.agents);
      fs.writeFileSync(fx.agents, "# Hand edit\n");
      const held = await apply(fx, ["base"]);
      expect(held.conflicts).toHaveLength(1);
      expect(held.conflicts[0].reason).toBe("replaced");
      expect(held.conflicts[0].edits[0].owner).toBeNull();
      expect(fs.lstatSync(fx.agents).isSymbolicLink()).toBe(false);
      expect(read(fx.agents)).toBe("# Hand edit\n");

      fs.writeFileSync(fx.agents, composed);
      const relinked = await apply(fx, ["base"]);
      expect(relinked.conflicts).toEqual([]);
      expect(fs.lstatSync(fx.agents).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(fx.agents)).toBe(fs.realpathSync(fx.generated));
    } finally {
      cleanup(fx);
    }
  });

  it("migrates old AGENTS.md symlink and CLAUDE.md wrapper state", async () => {
    const fx = createFixture();
    try {
      const baseSource = path.join(fx.loadoutRoot, "instructions/AGENTS.base.md");
      const wrapper = "# Claude Code Instructions\n\nSee [AGENTS.md](AGENTS.md) for project instructions.\n";
      fs.symlinkSync(path.relative(fx.projectRoot, baseSource), fx.agents);
      fs.writeFileSync(path.join(fx.projectRoot, "CLAUDE.md"), wrapper);
      fs.writeFileSync(
        path.join(fx.loadoutRoot, ".state.json"),
        JSON.stringify({
          active: ["base"],
          mode: "symlink",
          appliedAt: new Date().toISOString(),
          entries: [
            {
              tools: ["codex", "cursor", "opencode", "pi"],
              kind: "instruction",
              sourcePath: baseSource,
              targetPath: "AGENTS.md",
              mode: "symlink",
              renderedHash: hashContent("# Base\n"),
            },
            {
              tools: ["claude-code"],
              kind: "instruction",
              sourcePath: baseSource,
              targetPath: "CLAUDE.md",
              mode: "generate",
              renderedHash: hashContent(wrapper),
            },
          ],
          shadowed: [],
        })
      );

      const result = await apply(fx, ["base"]);
      expect(result.conflicts).toEqual([]);
      expect(fs.existsSync(path.join(fx.projectRoot, "CLAUDE.md"))).toBe(false);
      expect(fs.realpathSync(fx.agents)).toBe(fs.realpathSync(fx.generated));
      expect(result.changes.removed).toContain(`CLAUDE.md\0${baseSource}`);
    } finally {
      cleanup(fx);
    }
  });

  it("adopts an untracked AGENTS.md symlink into the loadout root", async () => {
    const fx = createFixture();
    try {
      const baseSource = path.join(fx.loadoutRoot, "instructions/AGENTS.base.md");
      fs.symlinkSync(path.relative(fx.projectRoot, baseSource), fx.agents);

      const [{ plan }] = await plansFor(fx, ["base"]);
      expect(plan.shadowed).toEqual([]);
      await apply(fx, ["base"]);
      expect(fs.realpathSync(fx.agents)).toBe(fs.realpathSync(fx.generated));
    } finally {
      cleanup(fx);
    }
  });

  it("shadows a hand-written AGENTS.md and leaves it intact", async () => {
    const fx = createFixture();
    try {
      fs.writeFileSync(fx.agents, "# Mine\n");

      const [{ plan }] = await plansFor(fx, ["base"]);
      expect(plan.shadowed.some((s) => s.targetPath === "AGENTS.md")).toBe(true);
      await apply(fx, ["base"]);
      expect(fs.lstatSync(fx.agents).isSymbolicLink()).toBe(false);
      expect(read(fx.agents)).toBe("# Mine\n");
      expect(fs.existsSync(fx.generated)).toBe(false);
    } finally {
      cleanup(fx);
    }
  });

  it("dropping the last instruction deletes the generated file and AGENTS.md", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base", "py"]);
      fs.writeFileSync(
        path.join(fx.loadoutRoot, "loadouts/py.yaml"),
        `name: py\ntools:\n  - opencode\ninclude:\n  - skills/debugger\n`
      );
      await apply(fx, ["py"]);
      expect(fs.existsSync(fx.generated)).toBe(false);
      expect(fs.existsSync(fx.agents) || fs.lstatSync(fx.agents, { throwIfNoEntry: false })).toBeFalsy();
    } finally {
      cleanup(fx);
    }
  });

  it("removeManaged backs up an edited generated file and warns", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base"]);
      fs.writeFileSync(fx.generated, read(fx.generated).replace("# Base", "# Base (edited)"));

      const result = await removeManaged(fx.loadoutRoot, fx.projectRoot, "project");
      expect(result.warnings).toHaveLength(1);
      expect(read(path.join(fx.loadoutRoot, "AGENTS.loadouts-generated.md.bak"))).toContain("# Base (edited)");
      expect(fs.existsSync(fx.generated)).toBe(false);
      expect(fs.lstatSync(fx.agents, { throwIfNoEntry: false })).toBeUndefined();
    } finally {
      cleanup(fx);
    }
  });

  it("warns when the composed file exceeds codex's byte limit", async () => {
    const fx = createFixture({ "instructions/AGENTS.base.md": `# Big\n${"x".repeat(33 * 1024)}\n` });
    try {
      const result = await apply(fx, ["base"]);
      expect(
        result.warnings.some((w) =>
          /^AGENTS\.md is 33\.\d KiB; codex reads only the first 32 KiB \(project_doc_max_bytes\)/.test(w)
        )
      ).toBe(true);
    } finally {
      cleanup(fx);
    }
  });

  it("warns when a CLAUDE.md suppresses AGENTS.md for Claude Code", async () => {
    const fx = createFixture();
    try {
      fs.mkdirSync(fx.projectRoot, { recursive: true });
      fs.writeFileSync(path.join(fx.projectRoot, "CLAUDE.md"), "# Old\n");
      const result = await apply(fx, ["base"]);
      expect(result.warnings).toContain(
        "Claude Code reads CLAUDE.md instead of AGENTS.md while CLAUDE.md exists; move its content into an instruction source and delete it."
      );
    } finally {
      cleanup(fx);
    }
  });

  it("gitignores the generated file in .loadouts/.gitignore", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base"]);
      const gitignore = read(path.join(fx.loadoutRoot, ".gitignore"));
      expect(gitignore).toContain("AGENTS.loadouts-generated.md");
      expect(gitignore).toContain("AGENTS.loadouts-generated.md.bak");
    } finally {
      cleanup(fx);
    }
  });

  it("expandDriftBySource reports one result per composed source", async () => {
    const fx = createFixture();
    try {
      await apply(fx, ["base", "py"]);
      const drift = expandDriftBySource(detectDrift(loadState(fx.loadoutRoot)!, fx.projectRoot));
      const agents = drift.filter((d) => d.entry.targetPath === "AGENTS.md");
      expect(agents.map((d) => path.basename(d.entry.sourcePath))).toEqual(["AGENTS.base.md", "AGENTS.py.md"]);
      expect(agents.every((d) => d.status === "ok")).toBe(true);
      const stateEntry = loadState(fx.loadoutRoot)!.entries.find((e) => e.targetPath === "AGENTS.md")!;
      expect(entrySources(stateEntry)).toEqual(agents.map((d) => d.entry.sourcePath));
    } finally {
      cleanup(fx);
    }
  });

  it("resolves global instruction targets per tool", () => {
    const item: ResolvedItem = {
      kind: "instruction",
      sourcePath: "/x/instructions/AGENTS.base.md",
      relativePath: "instructions/AGENTS.base.md",
      tools: ["claude-code", "cursor", "codex", "pi"],
    };
    const home = os.homedir();
    expect(resolveOutputSpec("claude-code", item, "global")?.targetPath).toBe(path.join(home, ".claude", "CLAUDE.md"));
    expect(resolveOutputSpec("cursor", item, "global")).toBeNull();
    expect(resolveOutputSpec("codex", item, "global")?.targetPath).toBe(path.join(home, ".codex", "AGENTS.md"));
    expect(resolveOutputSpec("pi", item, "global")?.targetPath).toBe(path.join(home, ".pi", "agent", "AGENTS.md"));
    expect(resolveOutputSpec("claude-code", item, "project")?.targetPath).toBe("AGENTS.md");
    expect(resolveOutputSpec("claude-code", item, "project")?.mode).toBe("symlink");
  });
});
