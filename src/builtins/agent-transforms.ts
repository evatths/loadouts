import * as path from "node:path";
import {
  parseMarkdownFrontmatter,
  serializeMarkdownFrontmatter,
  type RawFrontmatter,
} from "../core/config.js";
import { readFile } from "../lib/fs.js";
import type { OutputMode, ResolvedItem } from "../core/types.js";

type AgentTarget = "opencode" | "cursor" | "claude-code" | "codex";

const MARKDOWN_NATIVE_KEYS: Record<Exclude<AgentTarget, "codex">, Set<string>> = {
  opencode: new Set([
    "description",
    "mode",
    "model",
    "variant",
    "reasoningEffort",
    "temperature",
    "top_p",
    "steps",
    "disable",
    "hidden",
    "color",
    "permission",
  ]),
  cursor: new Set([
    "name",
    "description",
    "model",
    "readonly",
    "is_background",
  ]),
  "claude-code": new Set([
    "name",
    "description",
    "tools",
    "disallowedTools",
    "model",
    "permissionMode",
    "maxTurns",
    "skills",
    "mcpServers",
    "hooks",
    "memory",
    "background",
    "effort",
    "isolation",
    "color",
    "initialPrompt",
  ]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function getAgentName(item: ResolvedItem | undefined): string {
  if (!item) return "agent";
  return path.basename(item.sourcePath, path.extname(item.sourcePath));
}

function getTargets(frontmatter: RawFrontmatter): Record<string, unknown> {
  return isRecord(frontmatter.targets) ? frontmatter.targets : {};
}

function getTargetOverlay(
  frontmatter: RawFrontmatter,
  target: AgentTarget
): Record<string, unknown> {
  const targets = getTargets(frontmatter);
  const overlay = targets[target];
  return isRecord(overlay) ? overlay : {};
}

function omitLoadoutsOnlyFields(frontmatter: RawFrontmatter): Record<string, unknown> {
  const result = cloneRecord(frontmatter);
  delete result.targets;
  return result;
}

function mergePermission(
  frontmatter: Record<string, unknown>,
  permission: Record<string, unknown>
): void {
  const existing = isRecord(frontmatter.permission) ? frontmatter.permission : {};
  frontmatter.permission = { ...existing, ...permission };
}

function removeUndefined(frontmatter: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([, value]) => value !== undefined)
  );
}

function filterKnownKeys(
  frontmatter: Record<string, unknown>,
  target: Exclude<AgentTarget, "codex">
): Record<string, unknown> {
  const allowed = MARKDOWN_NATIVE_KEYS[target];
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => allowed.has(key))
  );
}

function canSymlinkMarkdownAgent(raw: string, target: Exclude<AgentTarget, "codex">): boolean {
  const { frontmatter } = parseMarkdownFrontmatter(raw);
  if (Object.keys(getTargets(frontmatter)).length > 0) return false;

  const allowed = MARKDOWN_NATIVE_KEYS[target];
  if (!Object.keys(frontmatter).every((key) => allowed.has(key))) return false;

  if (target === "opencode") {
    return typeof frontmatter.description === "string" && frontmatter.description.length > 0;
  }

  if (target === "claude-code") {
    return (
      typeof frontmatter.name === "string" &&
      frontmatter.name.length > 0 &&
      typeof frontmatter.description === "string" &&
      frontmatter.description.length > 0
    );
  }

  return true;
}

export function selectAgentMarkdownMode(target: Exclude<AgentTarget, "codex">) {
  return (item: ResolvedItem): OutputMode => {
    const raw = readFile(item.sourcePath);
    return canSymlinkMarkdownAgent(raw, target) ? "symlink" : "copy";
  };
}

function buildOpenCodeFrontmatter(
  frontmatter: RawFrontmatter,
  item: ResolvedItem | undefined
): Record<string, unknown> {
  const overlay = getTargetOverlay(frontmatter, "opencode");
  const result = filterKnownKeys(omitLoadoutsOnlyFields(frontmatter), "opencode");

  if (result.model === "inherit") delete result.model;
  if (typeof result.description !== "string" || result.description.length === 0) {
    result.description = `${getAgentName(item)} agent`;
  }

  const merged = { ...result, ...overlay };
  if (frontmatter.readonly === true) {
    mergePermission(merged, { edit: "deny" });
  }

  return removeUndefined(merged);
}

function buildCursorFrontmatter(
  frontmatter: RawFrontmatter,
  item: ResolvedItem | undefined
): Record<string, unknown> {
  const overlay = getTargetOverlay(frontmatter, "cursor");
  const result = filterKnownKeys(omitLoadoutsOnlyFields(frontmatter), "cursor");

  result.name = typeof result.name === "string" ? result.name : getAgentName(item);
  if (typeof result.description !== "string" || result.description.length === 0) {
    result.description = `${result.name} agent`;
  }
  if (frontmatter.background !== undefined && result.is_background === undefined) {
    result.is_background = frontmatter.background;
  }

  return removeUndefined({ ...result, ...overlay });
}

function buildClaudeFrontmatter(
  frontmatter: RawFrontmatter,
  item: ResolvedItem | undefined
): Record<string, unknown> {
  const overlay = getTargetOverlay(frontmatter, "claude-code");
  const result = filterKnownKeys(omitLoadoutsOnlyFields(frontmatter), "claude-code");

  result.name = typeof result.name === "string" ? result.name : getAgentName(item);
  if (typeof result.description !== "string" || result.description.length === 0) {
    result.description = `${result.name} agent`;
  }
  if (frontmatter.readonly === true && result.permissionMode === undefined) {
    result.permissionMode = "plan";
  }
  if (frontmatter.background !== undefined && result.background === undefined) {
    result.background = frontmatter.background;
  }

  return removeUndefined({ ...result, ...overlay });
}

export function renderOpenCodeAgent(raw: string, item?: ResolvedItem): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  return serializeMarkdownFrontmatter(buildOpenCodeFrontmatter(frontmatter, item), body);
}

export function renderCursorAgent(raw: string, item?: ResolvedItem): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  return serializeMarkdownFrontmatter(buildCursorFrontmatter(frontmatter, item), body);
}

export function renderClaudeAgent(raw: string, item?: ResolvedItem): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  return serializeMarkdownFrontmatter(buildClaudeFrontmatter(frontmatter, item), body);
}

function buildCodexConfig(
  frontmatter: RawFrontmatter,
  body: string,
  item: ResolvedItem | undefined
): Record<string, unknown> {
  const overlay = getTargetOverlay(frontmatter, "codex");
  const result: Record<string, unknown> = {
    name: typeof frontmatter.name === "string" ? frontmatter.name : getAgentName(item),
    description:
      typeof frontmatter.description === "string" && frontmatter.description.length > 0
        ? frontmatter.description
        : `${getAgentName(item)} agent`,
    developer_instructions: body.trim(),
  };

  if (typeof frontmatter.model === "string" && frontmatter.model !== "inherit") {
    result.model = frontmatter.model;
  }
  if (frontmatter.readonly === true) {
    result.sandbox_mode = "read-only";
  }

  return removeUndefined({ ...result, ...overlay });
}

function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function formatTomlString(value: string): string {
  if (value.includes("\n")) {
    return `"""\n${value.replaceAll('"""', '\\"\\"\\"')}\n"""`;
  }
  return JSON.stringify(value);
}

function formatTomlValue(value: unknown): string {
  if (typeof value === "string") return formatTomlString(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return '""';
  if (Array.isArray(value) && value.every(isScalar)) {
    return `[${value.map(formatTomlValue).join(", ")}]`;
  }
  throw new Error("Unsupported TOML value in agent config.");
}

function renderTomlObject(
  value: Record<string, unknown>,
  prefix: string[] = []
): string[] {
  const lines: string[] = [];
  const nested: Array<[string, Record<string, unknown>]> = [];
  const objectArrays: Array<[string, Record<string, unknown>[]]> = [];

  for (const [key, entry] of Object.entries(value)) {
    if (isScalar(entry) || (Array.isArray(entry) && entry.every(isScalar))) {
      lines.push(`${key} = ${formatTomlValue(entry)}`);
      continue;
    }

    if (Array.isArray(entry) && entry.every(isRecord)) {
      objectArrays.push([key, entry]);
      continue;
    }

    if (isRecord(entry)) {
      nested.push([key, entry]);
      continue;
    }

    throw new Error(`Unsupported TOML value for key "${key}" in agent config.`);
  }

  for (const [key, entry] of nested) {
    lines.push("");
    lines.push(`[${[...prefix, key].join(".")}]`);
    lines.push(...renderTomlObject(entry, [...prefix, key]));
  }

  for (const [key, entries] of objectArrays) {
    for (const entry of entries) {
      lines.push("");
      lines.push(`[[${[...prefix, key].join(".")}]]`);
      lines.push(...renderTomlObject(entry, [...prefix, key]));
    }
  }

  return lines;
}

export function renderCodexAgent(raw: string, item?: ResolvedItem): string {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  return `${renderTomlObject(buildCodexConfig(frontmatter, body, item)).join("\n")}\n`;
}
