/**
 * Parse source configs and loadout definitions
 */

import * as path from "node:path";
import * as yaml from "yaml";
import { readFile, writeFile, fileExists, isDirectory, listFiles } from "../lib/fs.js";
import {
  RootConfigSchema,
  LoadoutDefinitionSchema,
  FrontmatterSchema,
  SkillFrontmatterSchema,
  CanonicalRuleFrontmatterSchema,
  type RuleFrontmatter,
  type CanonicalRuleFrontmatter,
  type SkillFrontmatter,
  type Frontmatter,
} from "./schema.js";
import type {
  RootConfig,
  LoadoutDefinition,
  LoadoutRoot,
} from "./types.js";

const ROOT_CONFIG_FILE = "loadouts.yaml";
const LOADOUTS_DIR = "loadouts";
const RULES_DIR = "rules";
const SKILLS_DIR = "skills";

export interface FrontmatterSanitizationResult<T extends Frontmatter> {
  frontmatter: T;
  changes: string[];
}

export interface FileSanitizationResult {
  modified: boolean;
  changes: string[];
}

export type RawFrontmatter = Record<string, unknown>;

/**
 * Parse markdown frontmatter without schema validation.
 */
export function parseMarkdownFrontmatter(content: string): {
  frontmatter: RawFrontmatter;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const [, frontmatterStr, body] = match;
  const parsed = yaml.parse(frontmatterStr);
  const frontmatter =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  return { frontmatter, body };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * Parse the root config from a .loadouts/ directory.
 * Returns default config if file doesn't exist.
 */
export function parseRootConfig(loadoutRoot: string): RootConfig {
  const configPath = path.join(loadoutRoot, ROOT_CONFIG_FILE);

  if (!fileExists(configPath)) {
    return { version: "1" };
  }

  const content = readFile(configPath);
  const parsed = yaml.parse(content);
  return RootConfigSchema.parse(parsed);
}

/**
 * Parse a loadout definition file.
 */
export function parseLoadoutDefinition(filePath: string): LoadoutDefinition {
  const content = readFile(filePath);
  const parsed = yaml.parse(content);
  return LoadoutDefinitionSchema.parse(parsed);
}

/**
 * List available loadouts in a .loadouts/ directory.
 */
export function listLoadouts(loadoutRoot: string): string[] {
  const loadoutsDir = path.join(loadoutRoot, LOADOUTS_DIR);

  if (!isDirectory(loadoutsDir)) {
    return [];
  }

  return listFiles(loadoutsDir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => f.replace(/\.ya?ml$/, ""));
}

/**
 * Find a loadout definition by name, searching from nearest root upward.
 */
export function findLoadoutDefinition(
  name: string,
  roots: LoadoutRoot[]
): { definition: LoadoutDefinition; rootPath: string } | null {
  for (const root of roots) {
    const yamlPath = path.join(root.path, LOADOUTS_DIR, `${name}.yaml`);
    const ymlPath = path.join(root.path, LOADOUTS_DIR, `${name}.yml`);

    const filePath = fileExists(yamlPath)
      ? yamlPath
      : fileExists(ymlPath)
        ? ymlPath
        : null;

    if (filePath) {
      return {
        definition: parseLoadoutDefinition(filePath),
        rootPath: root.path,
      };
    }
  }

  return null;
}

/**
 * Parse frontmatter from a markdown file.
 * Returns the frontmatter object and the body content.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const { frontmatter: parsed, body } = parseMarkdownFrontmatter(content);
  const frontmatter = FrontmatterSchema.parse(parsed);

  return { frontmatter, body };
}

/**
 * Parse skill frontmatter from a SKILL.md file.
 */
export function parseSkillFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const { frontmatter: parsed, body } = parseMarkdownFrontmatter(content);
  const frontmatter = SkillFrontmatterSchema.parse(parsed);
  return { frontmatter, body };
}

/**
 * Serialize markdown frontmatter without schema constraints.
 */
export function serializeMarkdownFrontmatter(
  frontmatter: RawFrontmatter,
  body: string
): string {
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }

  const frontmatterStr = yaml.stringify(frontmatter).trim();
  return `---\n${frontmatterStr}\n---\n${body}`;
}

/**
 * Serialize frontmatter and body back to markdown.
 */
export function serializeFrontmatter(
  frontmatter: Frontmatter,
  body: string
): string {
  return serializeMarkdownFrontmatter(frontmatter, body);
}

/**
 * Sanitize rule frontmatter for canonical v1 portability.
 */
export function sanitizeRuleFrontmatter(
  frontmatter: RuleFrontmatter,
  ruleName?: string
): CanonicalRuleFrontmatter {
  return sanitizeRuleFrontmatterWithSummary(frontmatter, ruleName).frontmatter;
}

/**
 * Sanitize rule frontmatter and return a concise change summary.
 */
export function sanitizeRuleFrontmatterWithSummary(
  frontmatter: RuleFrontmatter,
  ruleName?: string
): FrontmatterSanitizationResult<CanonicalRuleFrontmatter> {
  const result = { ...frontmatter };
  const changes: string[] = [];
  const explicitAlwaysApply = result.alwaysApply;

  const hadGlobsAlias = "globs" in result;
  const pathsBeforeAliasHandling = result.paths;
  const globsBeforeAliasHandling = result.globs;

  if (
    Array.isArray(pathsBeforeAliasHandling)
    && Array.isArray(globsBeforeAliasHandling)
    && stableStringify(pathsBeforeAliasHandling) !== stableStringify(globsBeforeAliasHandling)
  ) {
    changes.push("~ conflicting alias ignored: globs (kept paths)");
  }

  if (result.globs && !result.paths) {
    result.paths = result.globs;
    changes.push("~ globs -> paths");
  }

  if (hadGlobsAlias) {
    delete result.globs;
    if (!changes.includes("~ globs -> paths")) {
      changes.push("~ removed alias: globs");
    }
  }

  if ("alwaysApply" in result) {
    delete result.alwaysApply;
    changes.push("~ alwaysApply -> activation");
  }

  let canonicalActivation: "always" | "scoped";
  if (typeof explicitAlwaysApply === "boolean") {
    canonicalActivation = explicitAlwaysApply || result.paths === undefined
      ? "always"
      : "scoped";
  } else if (result.activation === "always" || result.activation === "scoped") {
    canonicalActivation = result.activation;
  } else {
    canonicalActivation = result.paths === undefined ? "always" : "scoped";
  }
  if (result.activation !== canonicalActivation) {
    result.activation = canonicalActivation;
    changes.push(`~ activation -> ${canonicalActivation}`);
  }

  if (!result.description && ruleName) {
    const humanName = ruleName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    result.description = `${humanName} guidelines`;
    changes.push("~ added description");
  }

  return {
    frontmatter: CanonicalRuleFrontmatterSchema.parse(result),
    changes,
  };
}

/**
 * Check if a rule file needs sanitization.
 * Returns true if the file would be modified by sanitization.
 */
export function ruleNeedsSanitization(filePath: string): boolean {
  return ruleSanitizationChanges(filePath).length > 0;
}

/**
 * Return a concise list of rule-frontmatter sanitization changes.
 */
export function ruleSanitizationChanges(filePath: string): string[] {
  const content = readFile(filePath);
  const { frontmatter } = parseFrontmatter(content);
  const ruleName = path.basename(filePath, ".md");
  return sanitizeRuleFrontmatterWithSummary(frontmatter, ruleName).changes;
}

/**
 * Sanitize a rule file in place.
 * Returns true if the file was modified.
 */
export function sanitizeRuleFile(filePath: string): boolean {
  return sanitizeRuleFileWithSummary(filePath).modified;
}

/**
 * Sanitize a rule file in place and return change details.
 */
export function sanitizeRuleFileWithSummary(filePath: string): FileSanitizationResult {
  const content = readFile(filePath);
  const { frontmatter, body } = parseFrontmatter(content);
  const ruleName = path.basename(filePath, ".md");
  const { frontmatter: sanitized, changes } = sanitizeRuleFrontmatterWithSummary(
    frontmatter,
    ruleName
  );

  // Check if anything changed
  const originalStr = stableStringify(frontmatter);
  const sanitizedStr = stableStringify(sanitized);

  if (originalStr === sanitizedStr) {
    return { modified: false, changes: [] };
  }

  const newContent = serializeFrontmatter(sanitized, body);
  writeFile(filePath, newContent);
  return { modified: true, changes };
}

/**
 * Find all rules that need sanitization in a loadout root.
 */
export function findUnsanitizedRules(loadoutRoot: string): string[] {
  const rulesDir = path.join(loadoutRoot, RULES_DIR);
  if (!isDirectory(rulesDir)) return [];

  const unsanitized: string[] = [];
  for (const file of listFiles(rulesDir)) {
    if (!file.endsWith(".md")) continue;
    const rulePath = path.join(rulesDir, file);
    if (ruleNeedsSanitization(rulePath)) {
      unsanitized.push(file.replace(/\.md$/, ""));
    }
  }
  return unsanitized;
}

/**
 * Sanitize skill frontmatter for canonical v1 portability.
 */
export function sanitizeSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  skillName?: string,
): SkillFrontmatter {
  return sanitizeSkillFrontmatterWithSummary(frontmatter, skillName).frontmatter;
}

/**
 * Sanitize skill frontmatter and return a concise change summary.
 */
export function sanitizeSkillFrontmatterWithSummary(
  frontmatter: SkillFrontmatter,
  skillName?: string,
): FrontmatterSanitizationResult<SkillFrontmatter> {
  const result = { ...frontmatter };
  const changes: string[] = [];

  if (!result.name && skillName) {
    result.name = skillName;
    changes.push("~ added name");
  }

  if (!result.description) {
    result.description = skillName
      ? `${skillName} skill for AI coding agents`
      : "Skill for AI coding agents";
    changes.push("~ added description");
  }

  const disableModelInvocation = result["disable-model-invocation"];
  const canonicalModelInvocable = result["model-invocable"];

  if (typeof disableModelInvocation === "boolean") {
    const aliasModelInvocable = !disableModelInvocation;
    if (typeof canonicalModelInvocable === "boolean") {
      if (canonicalModelInvocable !== aliasModelInvocable) {
        changes.push(
          "~ conflicting alias ignored: disable-model-invocation (kept model-invocable)"
        );
      }
    } else {
      result["model-invocable"] = aliasModelInvocable;
      changes.push(
        `~ disable-model-invocation -> model-invocable: ${aliasModelInvocable}`
      );
    }
    delete result["disable-model-invocation"];
    changes.push("~ removed alias: disable-model-invocation");
  }

  if (typeof result["user-invocable"] !== "boolean") {
    result["user-invocable"] = true;
    changes.push("~ user-invocable -> true");
  }

  if (typeof result["model-invocable"] !== "boolean") {
    result["model-invocable"] = true;
    changes.push("~ model-invocable -> true");
  }

  return { frontmatter: result, changes };
}

/**
 * Check if a skill file needs sanitization.
 */
export function skillNeedsSanitization(filePath: string): boolean {
  return skillSanitizationChanges(filePath).length > 0;
}

/**
 * Return a concise list of skill-frontmatter sanitization changes.
 */
export function skillSanitizationChanges(filePath: string): string[] {
  const content = readFile(filePath);
  const { frontmatter } = parseSkillFrontmatter(content);
  const skillName = path.basename(path.dirname(filePath));
  return sanitizeSkillFrontmatterWithSummary(frontmatter, skillName).changes;
}

/**
 * Sanitize a skill file in place.
 * Returns true if the file was modified.
 */
export function sanitizeSkillFile(filePath: string): boolean {
  return sanitizeSkillFileWithSummary(filePath).modified;
}

/**
 * Sanitize a skill file in place and return change details.
 */
export function sanitizeSkillFileWithSummary(filePath: string): FileSanitizationResult {
  const content = readFile(filePath);
  const { frontmatter, body } = parseSkillFrontmatter(content);
  const skillName = path.basename(path.dirname(filePath));
  const { frontmatter: sanitized, changes } = sanitizeSkillFrontmatterWithSummary(
    frontmatter,
    skillName
  );

  const originalStr = stableStringify(frontmatter);
  const sanitizedStr = stableStringify(sanitized);

  if (originalStr === sanitizedStr) {
    return { modified: false, changes: [] };
  }

  const newContent = serializeFrontmatter(sanitized, body);
  writeFile(filePath, newContent);
  return { modified: true, changes };
}

/**
 * Find all skills that need sanitization in a loadout root.
 */
export function findUnsanitizedSkills(loadoutRoot: string): string[] {
  const skillsDir = path.join(loadoutRoot, SKILLS_DIR);
  if (!isDirectory(skillsDir)) return [];

  const unsanitized: string[] = [];
  for (const entry of listFiles(skillsDir)) {
    const skillDir = path.join(skillsDir, entry);
    if (!isDirectory(skillDir)) continue;

    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fileExists(skillMdPath)) continue;

    if (skillNeedsSanitization(skillMdPath)) {
      unsanitized.push(entry);
    }
  }

  return unsanitized;
}
