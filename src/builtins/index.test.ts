import { beforeEach, describe, expect, it } from "vitest";
import { Registry } from "../core/registry.js";
import { createPluginAPI } from "../core/plugin.js";
import { registerBuiltins } from "./index.js";

let registry: Registry;

beforeEach(() => {
  registry = new Registry();
  registerBuiltins(createPluginAPI(registry));
});

describe("opencode-plugin-dir kind", () => {
  it("registers the kind with dir layout and plugin-directory detection", () => {
    const kind = registry.getKind("opencode-plugin-dir");
    expect(kind).toBeDefined();
    expect(kind!.layout).toBe("dir");
    expect(kind!.detect("opencode/plugins/loadouts")).toBe(true);
    expect(kind!.detect("opencode/plugins/loadouts/package.json")).toBe(true);
    expect(kind!.detect("opencode/plugins/loadouts-runtime.ts")).toBe(false);
    expect(kind!.detect("opencode/plugins/loadouts-runtime.tsx")).toBe(false);
    expect(kind!.detect("opencode/plugins/loadouts-runtime.js")).toBe(false);
    expect(kind!.detect("extensions/loadouts-runtime")).toBe(false);
  });

  it("does not shadow the file-based opencode-plugin kind", () => {
    expect(registry.inferKind("opencode/plugins/loadouts-runtime.ts")).toBe("opencode-plugin");
    expect(registry.inferKind("opencode/plugins/loadouts")).toBe("opencode-plugin-dir");
  });

  it("renders plugin directories to {base}/plugins/{name} via the opencode tool", () => {
    const tool = registry.getTool("opencode");
    expect(tool).toBeDefined();
    expect(tool!.supports).toContain("opencode-plugin-dir");
    expect(tool!.targets?.["opencode-plugin-dir"]).toEqual({
      path: "{base}/plugins/{name}",
      mode: "copy",
    });
  });

  it("resolves the opencode tool mapping for the dir kind", () => {
    const mapping = registry.resolveMapping("opencode", "opencode-plugin-dir");
    expect(mapping).toBeDefined();
    expect(mapping!.path).toBe("{base}/plugins/{name}");
    expect(mapping!.mode).toBe("copy");
  });
});

describe("built-in frontmatter render transforms", () => {
  it("renders canonical rule fields with cursor native aliases", () => {
    const transform = registry.getTransform("cursor-rule-frontmatter");
    expect(transform).toBeDefined();

    const source = `---
description: TypeScript standards
paths:
  - "**/*.ts"
activation: scoped
---

# Rule
`;

    const rendered = transform!(source);

    expect(source).not.toContain("globs:");
    expect(rendered).toContain("paths:");
    expect(rendered).toContain("globs:");
    expect(rendered).toContain("activation: scoped");
    expect(rendered).toContain("alwaysApply: false");
  });

  it("renders canonical rule fields with opencode native aliases", () => {
    const transform = registry.getTransform("opencode-rule-frontmatter");
    expect(transform).toBeDefined();

    const source = `---
description: Go standards
paths:
  - "**/*.go"
activation: always
---

# Rule
`;

    const rendered = transform!(source);

    expect(rendered).toContain("globs:");
    expect(rendered).toContain("alwaysApply: true");
  });

  it("renders canonical skill invocability with opencode alias", () => {
    const transform = registry.getTransform("opencode-skill-frontmatter");
    expect(transform).toBeDefined();

    const source = `---
name: debugging
description: Debug runtime failures.
user-invocable: true
model-invocable: false
---

# Debugging
`;

    const rendered = transform!(source);

    expect(rendered).toContain("user-invocable: true");
    expect(rendered).toContain("model-invocable: false");
    expect(rendered).toContain("disable-model-invocation: true");
  });

  it("preserves unknown frontmatter fields during render translation", () => {
    const transform = registry.getTransform("cursor-rule-frontmatter");
    expect(transform).toBeDefined();

    const source = `---
description: JS standards
paths:
  - "**/*.js"
custom:
  owner: infra
  risk: low
---

# Rule
`;

    const rendered = transform!(source);

    expect(rendered).toContain("custom:");
    expect(rendered).toContain("owner: infra");
    expect(rendered).toContain("risk: low");
    expect(rendered).toContain("globs:");
  });
});
