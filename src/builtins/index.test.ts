import { beforeEach, describe, expect, it } from "vitest";
import { Registry } from "../core/registry.js";
import { createPluginAPI } from "../core/plugin.js";
import { registerBuiltins } from "./index.js";

let registry: Registry;

beforeEach(() => {
  registry = new Registry();
  registerBuiltins(createPluginAPI(registry));
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
