import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseMarkdownFrontmatter,
  parseFrontmatter,
  ruleSanitizationChanges,
  sanitizeRuleFileWithSummary,
  sanitizeRuleFrontmatter,
  sanitizeRuleFrontmatterWithSummary,
  sanitizeSkillFileWithSummary,
  sanitizeSkillFrontmatter,
  sanitizeSkillFrontmatterWithSummary,
  serializeMarkdownFrontmatter,
  serializeFrontmatter,
  findUnsanitizedRules,
  findUnsanitizedSkills,
} from "./config.js";

describe("parseFrontmatter", () => {
  it("parses YAML frontmatter", () => {
    const content = `---
description: Test rule
paths: ["**/*.ts"]
---

Body content here.
`;
    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter.description).toBe("Test rule");
    expect(frontmatter.paths).toEqual(["**/*.ts"]);
    expect(body).toBe("\nBody content here.\n");
  });

  it("handles missing frontmatter", () => {
    const content = "Just body content.";
    const { frontmatter, body } = parseFrontmatter(content);

    expect(frontmatter).toEqual({});
    expect(body).toBe("Just body content.");
  });

  it("preserves unknown flat fields", () => {
    const content = `---
description: Test
custom-flag: enabled
priority: 7
---

Body
`;
    const { frontmatter } = parseFrontmatter(content);
    expect(frontmatter["custom-flag"]).toBe("enabled");
    expect(frontmatter.priority).toBe(7);
  });
});

describe("generic markdown frontmatter helpers", () => {
  it("parses and serializes unknown fields without dropping them", () => {
    const content = `---
description: Test rule
custom:
  nested: true
score: 9
---

Body
`;

    const { frontmatter, body } = parseMarkdownFrontmatter(content);
    expect(frontmatter.custom).toEqual({ nested: true });
    expect(frontmatter.score).toBe(9);

    const rendered = serializeMarkdownFrontmatter(frontmatter, body);
    expect(rendered).toContain("custom:");
    expect(rendered).toContain("nested: true");
    expect(rendered).toContain("score: 9");
  });
});

describe("serializeFrontmatter", () => {
  it("serializes frontmatter and body", () => {
    const frontmatter = { description: "Test", paths: ["**/*.ts"] };
    const body = "\nBody content.\n";

    const result = serializeFrontmatter(frontmatter, body);

    expect(result).toContain("description: Test");
    expect(result).toContain("Body content.");
  });

  it("returns body only when frontmatter is empty", () => {
    const result = serializeFrontmatter({}, "Body only.");
    expect(result).toBe("Body only.");
  });

  it("keeps unknown fields through serialize", () => {
    const result = serializeFrontmatter(
      { description: "Test", "custom-flag": "yes" },
      "Body"
    );
    expect(result).toContain("custom-flag: yes");
  });
});

describe("sanitizeRuleFrontmatter", () => {
  it("normalizes aliases to canonical fields", () => {
    const { frontmatter: result, changes } = sanitizeRuleFrontmatterWithSummary(
      {
        globs: ["src/**/*.ts"],
        alwaysApply: true,
        "custom-flag": "keep",
      },
      "ts-rules"
    );

    expect(changes).toContain("~ globs -> paths");
    expect(changes).toContain("~ alwaysApply -> activation");
    expect(changes).toContain("~ activation -> always");
    expect(result.description).toBe("Ts Rules guidelines");
    expect(result.paths).toEqual(["src/**/*.ts"]);
    expect(result.activation).toBe("always");
    expect(result.globs).toBeUndefined();
    expect(result.alwaysApply).toBeUndefined();
    expect(result["custom-flag"]).toBe("keep");
  });

  it("infers always activation when paths is absent", () => {
    const result = sanitizeRuleFrontmatter({ description: "x" }, "x");
    expect(result.activation).toBe("always");
  });

  it("preserves explicit canonical activation", () => {
    const result = sanitizeRuleFrontmatter({ paths: ["**/*.ts"], activation: "always" });
    expect(result.activation).toBe("always");
  });

  it("ignores conflicting globs alias when canonical paths exists", () => {
    const { frontmatter: result, changes } = sanitizeRuleFrontmatterWithSummary({
      paths: ["src/**/*.ts"],
      globs: ["lib/**/*.ts"],
    });

    expect(changes).toContain("~ conflicting alias ignored: globs (kept paths)");
    expect(result.paths).toEqual(["src/**/*.ts"]);
    expect(result.globs).toBeUndefined();
    expect(result.activation).toBe("scoped");
  });

  it("sanitizes invalid activation to inferred canonical value", () => {
    const result = sanitizeRuleFrontmatter({
      paths: ["src/**/*.ts"],
      activation: "sometimes",
    });

    expect(result.activation).toBe("scoped");
  });
});

describe("skill frontmatter", () => {
  it("adds defaults and converts known alias", () => {
    const { frontmatter: result, changes } = sanitizeSkillFrontmatterWithSummary(
      {
        "disable-model-invocation": true,
        tags: ["x"],
      },
      "debug"
    );

    expect(changes).toContain("~ added name");
    expect(changes).toContain("~ added description");
    expect(changes).toContain("~ disable-model-invocation -> model-invocable: false");
    expect(changes).toContain("~ removed alias: disable-model-invocation");
    expect(changes).toContain("~ user-invocable -> true");
    expect(result.name).toBe("debug");
    expect(result.description).toBe("debug skill for AI coding agents");
    expect(result["user-invocable"]).toBe(true);
    expect(result["model-invocable"]).toBe(false);
    expect(result["disable-model-invocation"]).toBeUndefined();
    expect(result.tags).toEqual(["x"]);
  });

  it("defaults model-invocable to true when alias is false", () => {
    const result = sanitizeSkillFrontmatter({ "disable-model-invocation": false });
    expect(result["model-invocable"]).toBe(true);
    expect(result["user-invocable"]).toBe(true);
  });

  it("keeps model-invocable when alias conflicts", () => {
    const { frontmatter: result, changes } = sanitizeSkillFrontmatterWithSummary({
      "model-invocable": true,
      "disable-model-invocation": true,
    });

    expect(changes).toContain(
      "~ conflicting alias ignored: disable-model-invocation (kept model-invocable)"
    );
    expect(changes).toContain("~ removed alias: disable-model-invocation");
    expect(result["model-invocable"]).toBe(true);
    expect(result["disable-model-invocation"]).toBeUndefined();
  });
});

describe("findUnsanitized artifacts", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("finds non-canonical rules and skills", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-config-test-"));
    tempDirs.push(root);

    fs.mkdirSync(path.join(root, "rules"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "debug"), { recursive: true });

    fs.writeFileSync(
      path.join(root, "rules", "lint.md"),
      `---\npaths:\n  - src/**/*.ts\n---\n\nRule body\n`
    );

    fs.writeFileSync(
      path.join(root, "skills", "debug", "SKILL.md"),
      `---\nname: debug\ndescription: Debugging help\n---\n\n# Debug\n`
    );

    expect(findUnsanitizedRules(root)).toEqual(["lint"]);
    expect(findUnsanitizedSkills(root)).toEqual(["debug"]);
  });
});

describe("file sanitization helpers", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("returns rule and skill change summaries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-config-summaries-"));
    tempDirs.push(root);

    const rulePath = path.join(root, "rule.md");
    const skillPath = path.join(root, "SKILL.md");

    fs.writeFileSync(rulePath, `---\nglobs:\n  - src/**/*.ts\n---\n\nRule\n`);
    fs.writeFileSync(skillPath, `---\ndisable-model-invocation: true\n---\n\nSkill\n`);

    expect(ruleSanitizationChanges(rulePath)).toContain("~ globs -> paths");

    const ruleResult = sanitizeRuleFileWithSummary(rulePath);
    const skillResult = sanitizeSkillFileWithSummary(skillPath);

    expect(ruleResult.modified).toBe(true);
    expect(ruleResult.changes.length).toBeGreaterThan(0);
    expect(skillResult.modified).toBe(true);
    expect(skillResult.changes).toContain("~ removed alias: disable-model-invocation");
    expect(skillResult.changes).toContain("~ user-invocable -> true");
    expect(skillResult.changes).toContain("~ disable-model-invocation -> model-invocable: false");
  });
});
