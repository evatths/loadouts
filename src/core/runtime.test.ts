import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { compileRuntimeBundle, renderRuntimeSystemBlock } from "./runtime.js";
import type { ResolvedItem, ResolvedLoadout } from "./types.js";

interface RuntimeFixture {
  tempDir: string;
  loadout: ResolvedLoadout;
}

function createFixture(): RuntimeFixture {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-runtime-test-"));
  const loadoutRoot = path.join(tempDir, ".loadouts");

  const instructionPath = path.join(loadoutRoot, "AGENTS.md");
  const rulePath = path.join(loadoutRoot, "rules", "typescript.md");
  const skillDir = path.join(loadoutRoot, "skills", "diagnose");
  const skillPath = path.join(skillDir, "SKILL.md");
  const unsupportedPath = path.join(loadoutRoot, "prompts", "helper.md");

  fs.mkdirSync(path.dirname(rulePath), { recursive: true });
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.dirname(unsupportedPath), { recursive: true });

  fs.writeFileSync(instructionPath, "# Project instruction\nDo not bypass tests.\n", "utf-8");
  fs.writeFileSync(rulePath, "# TypeScript rule\nPrefer explicit return types for public APIs.\n", "utf-8");
  fs.writeFileSync(
    skillPath,
    "---\nname: diagnose\ndescription: Diagnose flaky CI failures quickly.\n---\n# Diagnose\n",
    "utf-8"
  );
  fs.writeFileSync(unsupportedPath, "# Prompt\nThis is unsupported in runtime v1.\n", "utf-8");

  const items: ResolvedItem[] = [
    {
      kind: "instruction",
      sourcePath: instructionPath,
      relativePath: "AGENTS.md",
      tools: ["opencode"],
    },
    {
      kind: "rule",
      sourcePath: rulePath,
      relativePath: "rules/typescript.md",
      tools: ["opencode"],
    },
    {
      kind: "skill",
      sourcePath: skillDir,
      relativePath: "skills/diagnose",
      tools: ["opencode"],
    },
    {
      kind: "prompt",
      sourcePath: unsupportedPath,
      relativePath: "prompts/helper.md",
      tools: ["opencode"],
    },
  ];

  const loadout: ResolvedLoadout = {
    name: "base",
    description: "Base runtime fixture",
    tools: ["opencode"],
    items,
    rootPath: loadoutRoot,
  };

  return { tempDir, loadout };
}

describe("runtime compiler", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("classifies instructions, rules, and skills into runtime injection buckets", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);

    const bundle = compileRuntimeBundle("opencode", fixture.loadout, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.injection.instructions).toHaveLength(1);
    expect(bundle.injection.rules).toHaveLength(1);
    expect(bundle.injection.skills).toHaveLength(1);

    expect(bundle.injection.instructions[0].content).toContain("Do not bypass tests");
    expect(bundle.injection.rules[0].content).toContain("explicit return types");

    expect(bundle.injection.skills[0].name).toBe("diagnose");
    expect(bundle.injection.skills[0].description).toBe("Diagnose flaky CI failures quickly.");
    expect(bundle.injection.skills[0].path).toBe("skills/diagnose");

    const instructionComponent = bundle.components.find((c) => c.kind === "instruction");
    expect(instructionComponent).toBeDefined();
    if (!instructionComponent || instructionComponent.kind !== "instruction") return;
    expect(instructionComponent.content.length).toBeGreaterThan(0);
    expect(instructionComponent.contentHash.startsWith("sha256:")).toBe(true);
    expect(instructionComponent.tokenEstimate).toBeGreaterThan(0);
    expect(bundle.capabilities.runtimeMode).toBe("experimental-runtime");
    expect(bundle.capabilities.modelInjection.instructions).toBe(true);
    expect(bundle.capabilities.skillPathDiscovery).toBe(true);
  });

  it("uses conservative tool capability flags for filesystem-first tools", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);

    const bundle = compileRuntimeBundle("cursor", fixture.loadout);

    expect(bundle.capabilities.runtimeMode).toBe("filesystem-activation");
    expect(bundle.capabilities.modelInjection.instructions).toBe(false);
    expect(bundle.capabilities.modelInjection.rules).toBe(false);
    expect(bundle.capabilities.skillPathDiscovery).toBe(false);
    expect(bundle.capabilities.nativeSkillHotSwap).toBe(false);
  });

  it("emits diagnostics for unsupported artifact kinds without hard failure", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);

    const bundle = compileRuntimeBundle("opencode", fixture.loadout);

    expect(bundle.diagnostics).toHaveLength(1);
    expect(bundle.diagnostics[0].code).toBe("unsupported-kind");
    expect(bundle.diagnostics[0].kind).toBe("prompt");
    expect(bundle.diagnostics[0].relativePath).toBe("prompts/helper.md");
  });

  it("produces deterministic fingerprint independent of generatedAt", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);

    const first = compileRuntimeBundle("opencode", fixture.loadout, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = compileRuntimeBundle("opencode", fixture.loadout, {
      generatedAt: "2026-03-01T08:00:00.000Z",
    });

    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("treats loadout order as part of runtime semantics", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);
    const otherLoadout: ResolvedLoadout = {
      ...fixture.loadout,
      name: "other",
      items: [fixture.loadout.items[1]],
    };

    const first = compileRuntimeBundle("opencode", [fixture.loadout, otherLoadout], {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = compileRuntimeBundle("opencode", [otherLoadout, fixture.loadout], {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.components[0].loadout).toBe("base");
    expect(second.components[0].loadout).toBe("other");
  });

  it("renders system block text with path-discovery skill labeling", () => {
    const fixture = createFixture();
    tempDirs.push(fixture.tempDir);

    const bundle = compileRuntimeBundle("opencode", fixture.loadout, {
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const block = renderRuntimeSystemBlock(bundle);

    expect(block).toContain("[loadout-runtime:v1]");
    expect(block).toContain("instructionInjection=true");
    expect(block).toContain("## Instructions (Model Injection Ready)");
    expect(block).toContain("## Rules (Model Injection Ready)");
    expect(block).toContain("## Skills (Path Discovery Only)");
    expect(block).toContain("Native skill hot-swap is disabled in runtime v1");
    expect(block).toContain("path: skills/diagnose");
  });
});
