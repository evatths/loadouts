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

  it("renders whole-file OpenCode TUI config under .opencode", async () => {
    const sourcePath = path.join(loadoutRoot, "opencode", "tui.jsonc");
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(
      sourcePath,
      '{ "$schema": "https://opencode.ai/tui.json", "plugin": [] }\n',
      "utf-8"
    );

    const item: ResolvedItem = {
      kind: "opencode-tui-config",
      sourcePath,
      relativePath: "opencode/tui.jsonc",
      tools: ["opencode"],
    };
    const plan: RenderPlan = {
      outputs: [
        {
          spec: {
            tool: "opencode",
            kind: "opencode-tui-config",
            sourcePath,
            targetPath: ".opencode/tui.jsonc",
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

    const outputPath = path.join(projectRoot, ".opencode/tui.jsonc");
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
        ".opencode/plugins/loadouts-runtime-tui.tsx",
        ".opencode/plugins/loadouts-runtime.ts",
        ".opencode/tui.jsonc",
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
      expect(opencode).toContain("permission:");
      expect(opencode).toContain("edit: deny");
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
