import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseYamlKind, loadYamlKindsFromRoots } from "./kindLoader.js";
import { registry } from "./registry.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseYamlKind", () => {
  const fixturesDir = path.join(__dirname, "../../test-fixtures/kinds");

  beforeEach(() => {
    // Create fixtures directory
    fs.mkdirSync(fixturesDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(fixturesDir)) {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    }
  });

  it("parses a simple file-based kind with pathPrefix detection", () => {
    const yamlContent = `
id: test.snippet
description: Test snippets
detect:
  pathPrefix: snippets/
layout: file
targets:
  claude-code:
    path: "{base}/snippets/{stem}.md"
`;
    const filePath = path.join(fixturesDir, "snippet.yaml");
    fs.writeFileSync(filePath, yamlContent);

    const kind = parseYamlKind(filePath);

    expect(kind.id).toBe("test.snippet");
    expect(kind.description).toBe("Test snippets");
    expect(kind.layout).toBe("file");
    expect(kind.detect("snippets/foo.md")).toBe(true);
    expect(kind.detect("other/foo.md")).toBe(false);
    expect(kind.defaultTargets?.["claude-code"]).toEqual({
      path: "{base}/snippets/{stem}.md",
    });
  });

  it("parses a kind with pathExact detection", () => {
    const yamlContent = `
id: test.config
detect:
  pathExact: config.yaml
layout: file
`;
    const filePath = path.join(fixturesDir, "config.yaml");
    fs.writeFileSync(filePath, yamlContent);

    const kind = parseYamlKind(filePath);

    expect(kind.detect("config.yaml")).toBe(true);
    expect(kind.detect("other/config.yaml")).toBe(false);
  });

  it("parses a kind with multiple tool targets and extensions", () => {
    const yamlContent = `
id: test.prompt
detect:
  pathPrefix: prompts/
layout: file
targets:
  claude-code:
    path: "{base}/prompts/{stem}{ext}"
  cursor:
    path: "{base}/prompts/{stem}.mdc"
    ext: .mdc
  opencode:
    path: "{base}/prompts/{stem}{ext}"
`;
    const filePath = path.join(fixturesDir, "prompt.yaml");
    fs.writeFileSync(filePath, yamlContent);

    const kind = parseYamlKind(filePath);

    expect(kind.defaultTargets?.["claude-code"]).toEqual({
      path: "{base}/prompts/{stem}{ext}",
    });
    expect(kind.defaultTargets?.["cursor"]).toEqual({
      path: "{base}/prompts/{stem}.mdc",
      ext: ".mdc",
    });
  });

  it("parses a directory-layout kind", () => {
    const yamlContent = `
id: test.template
detect:
  pathPrefix: templates/
layout: dir
targets:
  claude-code:
    path: "{base}/templates/{stem}"
`;
    const filePath = path.join(fixturesDir, "template.yaml");
    fs.writeFileSync(filePath, yamlContent);

    const kind = parseYamlKind(filePath);

    expect(kind.layout).toBe("dir");
  });

  it("parses a kind with copy mode and transform", () => {
    const yamlContent = `
id: test.script
detect:
  pathPrefix: scripts/
layout: file
targets:
  claude-code:
    path: "{base}/scripts/{stem}.sh"
    mode: copy
    transform: strip-comments
`;
    const filePath = path.join(fixturesDir, "script.yaml");
    fs.writeFileSync(filePath, yamlContent);

    const kind = parseYamlKind(filePath);

    expect(kind.defaultTargets?.["claude-code"]).toEqual({
      path: "{base}/scripts/{stem}.sh",
      mode: "copy",
      transform: "strip-comments",
    });
  });

  it("throws on invalid YAML", () => {
    const yamlContent = `
id: test.bad
this is not valid yaml: [[[[
`;
    const filePath = path.join(fixturesDir, "bad.yaml");
    fs.writeFileSync(filePath, yamlContent);

    expect(() => parseYamlKind(filePath)).toThrow();
  });

  it("throws on missing required id field", () => {
    const yamlContent = `
description: Missing ID
detect:
  pathPrefix: foo/
layout: file
`;
    const filePath = path.join(fixturesDir, "no-id.yaml");
    fs.writeFileSync(filePath, yamlContent);

    expect(() => parseYamlKind(filePath)).toThrow();
  });

  it("throws on invalid layout value", () => {
    const yamlContent = `
id: test.bad
detect:
  pathPrefix: foo/
layout: invalid
`;
    const filePath = path.join(fixturesDir, "bad-layout.yaml");
    fs.writeFileSync(filePath, yamlContent);

    expect(() => parseYamlKind(filePath)).toThrow();
  });
});

describe("loadYamlKindsFromRoots", () => {
  const testRoot = path.join(__dirname, "../../test-fixtures/roots/test-root");
  const kindsDir = path.join(testRoot, "kinds");

  beforeEach(() => {
    // Clear the global registry for clean test state
    // Note: This is a bit hacky, but necessary since loadYamlKindsFromRoots uses the singleton
    (registry as any)._kinds.clear();
    (registry as any)._tools.clear();
    (registry as any)._transforms.clear();
    (registry as any)._hooks.clear();
    
    fs.mkdirSync(kindsDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it("loads multiple YAML kinds from a root", () => {
    // Create two kinds
    fs.writeFileSync(
      path.join(kindsDir, "snippet.yaml"),
      `
id: test.snippet
detect:
  pathPrefix: snippets/
layout: file
`
    );

    fs.writeFileSync(
      path.join(kindsDir, "template.yaml"),
      `
id: test.template
detect:
  pathPrefix: templates/
layout: dir
`
    );

    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);

    expect(registry.getKind("test.snippet")).toBeDefined();
    expect(registry.getKind("test.template")).toBeDefined();
  });

  it("skips non-yaml files", () => {
    fs.writeFileSync(path.join(kindsDir, "readme.txt"), "not a yaml file");
    fs.writeFileSync(
      path.join(kindsDir, "valid.yaml"),
      `
id: test.valid
detect:
  pathPrefix: valid/
layout: file
`
    );

    expect(() => {
      loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);
    }).not.toThrow();

    expect(registry.getKind("test.valid")).toBeDefined();
  });

  it("handles missing kinds directory gracefully", () => {
    fs.rmSync(kindsDir, { recursive: true, force: true });

    expect(() => {
      loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);
    }).not.toThrow();
  });

  it("does not warn when the same YAML kind file is loaded repeatedly", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(
      path.join(kindsDir, "snippet.yaml"),
      `
id: test.snippet
detect:
  pathPrefix: snippets/
layout: file
`
    );

    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);
    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);

    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it("does not show namespace notes by default", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(
      path.join(kindsDir, "snippet.yaml"),
      `
id: snippet
detect:
  pathPrefix: snippets/
layout: file
`
    );

    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);

    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it("shows a light namespace note when requested", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(
      path.join(kindsDir, "snippet.yaml"),
      `
id: snippet
detect:
  pathPrefix: snippets/
layout: file
`
    );

    loadYamlKindsFromRoots(
      [{ path: testRoot, level: "project", depth: 0 }],
      { showNamespaceNotes: true }
    );

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toBe(
      '[loadout] Note: custom kind "snippet" is unnamespaced. Consider "myteam.snippet" to avoid future name collisions.'
    );

    consoleWarnSpy.mockClear();
    loadYamlKindsFromRoots(
      [{ path: testRoot, level: "project", depth: 0 }],
      { showNamespaceNotes: true }
    );

    expect(consoleWarnSpy).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it("warns when a different YAML kind file reuses an existing ID", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(
      path.join(kindsDir, "a.yaml"),
      `
id: test.duplicate
detect:
  pathPrefix: a/
layout: file
`
    );

    fs.writeFileSync(
      path.join(kindsDir, "b.yaml"),
      `
id: test.duplicate
detect:
  pathPrefix: b/
layout: file
`
    );

    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain(
      '"test.duplicate" is already registered'
    );
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain(
      "existing definition takes precedence"
    );

    consoleWarnSpy.mockRestore();
  });

  it("warns but continues on parse errors", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fs.writeFileSync(path.join(kindsDir, "bad.yaml"), "invalid: yaml: content: [[[");
    fs.writeFileSync(
      path.join(kindsDir, "good.yaml"),
      `
id: test.good
detect:
  pathPrefix: good/
layout: file
`
    );

    loadYamlKindsFromRoots([{ path: testRoot, level: "project", depth: 0 }]);

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(registry.getKind("test.good")).toBeDefined();

    consoleWarnSpy.mockRestore();
  });
});
