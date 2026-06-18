import * as path from "node:path";
import {
  parseMarkdownFrontmatter,
  serializeMarkdownFrontmatter,
  type RawFrontmatter,
} from "./config.js";

export type AgentHarness = "opencode" | "cursor" | "claude-code" | "codex" | "canonical";

export interface CanonicalizeAgentOptions {
  harness?: AgentHarness;
  sourcePath: string;
}

export interface CanonicalizedAgent {
  name: string;
  content: string;
  harness: AgentHarness;
}

const OBSIDIAN_METADATA_KEYS = new Set(["aliases", "id", "tags"]);

const OPENCODE_KEYS = new Set([
  "description",
  "mode",
  "model",
  "variant",
  "temperature",
  "top_p",
  "steps",
  "maxSteps",
  "disable",
  "hidden",
  "color",
  "permission",
  "tools",
]);

const CURSOR_KEYS = new Set([
  "name",
  "description",
  "model",
  "readonly",
  "is_background",
]);

const CLAUDE_KEYS = new Set([
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
]);

const CODEX_COMMON_KEYS = new Set([
  "name",
  "description",
  "developer_instructions",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function slugFromPath(sourcePath: string): string {
  return path.basename(sourcePath, path.extname(sourcePath));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function setNested(
  target: Record<string, unknown>,
  keys: string[],
  value: unknown
): void {
  let cursor = target;
  for (const key of keys.slice(0, -1)) {
    const existing = cursor[key];
    if (!isRecord(existing)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function removeInlineComment(line: string): string {
  let inString = false;
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        quote = ch;
      } else if (quote === ch) {
        inString = false;
      }
    }
    if (ch === "#" && !inString) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function parseTomlScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseTomlScalar(item.trim()));
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }

  return trimmed;
}

function parseToml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;
  let currentPath: string[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    let line = removeInlineComment(lines[i]).trim();
    if (!line) continue;

    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      currentPath = arrayTable[1].split(".");
      const parentPath = currentPath.slice(0, -1);
      const leaf = currentPath[currentPath.length - 1];
      let parent = root;
      for (const key of parentPath) {
        if (!isRecord(parent[key])) parent[key] = {};
        parent = parent[key] as Record<string, unknown>;
      }
      const existing = Array.isArray(parent[leaf]) ? parent[leaf] as unknown[] : [];
      const next: Record<string, unknown> = {};
      existing.push(next);
      parent[leaf] = existing;
      current = next;
      continue;
    }

    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      currentPath = table[1].split(".");
      current = root;
      for (const key of currentPath) {
        if (!isRecord(current[key])) current[key] = {};
        current = current[key] as Record<string, unknown>;
      }
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!assignment) continue;

    const key = assignment[1];
    let value = assignment[2].trim();
    if (value.startsWith('"""')) {
      const first = value.slice(3);
      const collected: string[] = [];
      if (first.endsWith('"""')) {
        value = first.slice(0, -3);
      } else {
        if (first) collected.push(first);
        while (i + 1 < lines.length) {
          i += 1;
          const next = lines[i];
          const end = next.indexOf('"""');
          if (end >= 0) {
            collected.push(next.slice(0, end));
            break;
          }
          collected.push(next);
        }
        value = collected.join("\n").replace(/^\n|\n$/g, "");
      }
      setNested(current, key.split("."), value);
      continue;
    }

    setNested(current, key.split("."), parseTomlScalar(value));
  }

  return root;
}

function inferMarkdownHarness(frontmatter: RawFrontmatter): AgentHarness {
  if (isRecord(frontmatter.targets)) return "canonical";
  if ("permissionMode" in frontmatter || "maxTurns" in frontmatter || "disallowedTools" in frontmatter) {
    return "claude-code";
  }
  if ("readonly" in frontmatter || "is_background" in frontmatter) {
    return "cursor";
  }
  if ("mode" in frontmatter || "permission" in frontmatter) {
    return "opencode";
  }
  return "canonical";
}

export function inferAgentHarness(
  sourcePath: string,
  raw: string,
  tool?: string
): AgentHarness {
  if (tool === "opencode" || tool === "cursor" || tool === "claude-code" || tool === "codex") {
    return tool;
  }

  const normalized = sourcePath.replace(/\\/g, "/");
  if (/\.codex\/agents\/[^/]+\.toml$/.test(normalized) || /codex\/agents\/[^/]+\.toml$/.test(normalized)) {
    return "codex";
  }
  if (/\.opencode\/agents\//.test(normalized) || /opencode\/agents\//.test(normalized)) {
    return "opencode";
  }
  if (/\.cursor\/agents\//.test(normalized) || /cursor\/agents\//.test(normalized)) {
    return "cursor";
  }
  if (/\.claude\/agents\//.test(normalized) || /claude-code\/agents\//.test(normalized)) {
    return "claude-code";
  }
  if (path.extname(sourcePath).toLowerCase() === ".toml") return "codex";

  return inferMarkdownHarness(parseMarkdownFrontmatter(raw).frontmatter);
}

function isOpenCodeReadOnly(frontmatter: RawFrontmatter): boolean {
  const permission = isRecord(frontmatter.permission) ? frontmatter.permission : undefined;
  return permission?.edit === "deny";
}

function isClaudeReadOnly(frontmatter: RawFrontmatter): boolean {
  if (frontmatter.permissionMode === "plan") return true;
  if (typeof frontmatter.tools === "string") {
    return !/\b(Write|Edit|MultiEdit)\b/.test(frontmatter.tools);
  }
  if (Array.isArray(frontmatter.tools)) {
    return !frontmatter.tools.some((tool) => ["Write", "Edit", "MultiEdit"].includes(String(tool)));
  }
  return false;
}

function getEffort(source: Record<string, unknown>, harness: AgentHarness): string | undefined {
  if (harness === "codex") return stringValue(source.model_reasoning_effort);
  if (harness === "opencode") return stringValue(source.reasoningEffort);
  if (harness === "claude-code") return stringValue(source.effort);
  return undefined;
}

function addEffortAnalogs(
  targets: Record<string, unknown>,
  effort: string | undefined,
  sourceHarness: AgentHarness
): void {
  if (!effort) return;

  if (sourceHarness !== "opencode") {
    const opencode = isRecord(targets.opencode) ? targets.opencode : {};
    opencode.reasoningEffort ??= effort;
    targets.opencode = opencode;
  }
  if (sourceHarness !== "codex") {
    const codex = isRecord(targets.codex) ? targets.codex : {};
    codex.model_reasoning_effort ??= effort;
    targets.codex = codex;
  }
  if (sourceHarness !== "claude-code") {
    const claude = isRecord(targets["claude-code"]) ? targets["claude-code"] : {};
    claude.effort ??= effort;
    targets["claude-code"] = claude;
  }
}

function addStepAnalogs(
  targets: Record<string, unknown>,
  steps: number | undefined,
  sourceHarness: AgentHarness
): void {
  if (steps === undefined) return;
  if (sourceHarness !== "opencode") {
    const opencode = isRecord(targets.opencode) ? targets.opencode : {};
    opencode.steps ??= steps;
    targets.opencode = opencode;
  }
  if (sourceHarness !== "claude-code") {
    const claude = isRecord(targets["claude-code"]) ? targets["claude-code"] : {};
    claude.maxTurns ??= steps;
    targets["claude-code"] = claude;
  }
}

function cleanMarkdownMetadata(frontmatter: RawFrontmatter): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !OBSIDIAN_METADATA_KEYS.has(key))
  );
}

function markdownTargetOverlay(
  frontmatter: RawFrontmatter,
  harness: Exclude<AgentHarness, "codex" | "canonical">
): Record<string, unknown> {
  const cleaned = cleanMarkdownMetadata(frontmatter);
  const overlay: Record<string, unknown> = {};
  const nativeKeys = harness === "opencode"
    ? OPENCODE_KEYS
    : harness === "cursor"
      ? CURSOR_KEYS
      : CLAUDE_KEYS;

  for (const [key, value] of Object.entries(cleaned)) {
    if (key === "name" || key === "description" || key === "targets") continue;
    if (key === "readonly" || key === "background") continue;
    if (key === "model" && value === "inherit") continue;
    if (nativeKeys.has(key) || harness === "opencode") {
      overlay[key] = value;
    }
  }

  if (harness === "cursor" && "is_background" in overlay) {
    delete overlay.is_background;
  }
  if (harness === "claude-code" && "background" in overlay) {
    delete overlay.background;
  }

  return overlay;
}

function canonicalizeMarkdownAgent(
  raw: string,
  sourcePath: string,
  harness: Exclude<AgentHarness, "codex">
): CanonicalizedAgent {
  const { frontmatter, body } = parseMarkdownFrontmatter(raw);
  if (harness === "canonical") {
    const name = stringValue(frontmatter.name) ?? slugFromPath(sourcePath);
    return { name, content: serializeMarkdownFrontmatter(frontmatter, body), harness };
  }

  const name = stringValue(frontmatter.name) ?? slugFromPath(sourcePath);
  const targets: Record<string, unknown> = isRecord(frontmatter.targets)
    ? cloneRecord(frontmatter.targets)
    : {};
  const overlay = markdownTargetOverlay(frontmatter, harness);

  const canonical: Record<string, unknown> = {
    name,
    description: stringValue(frontmatter.description) ?? `${name} agent`,
  };

  if (frontmatter.model === "inherit") canonical.model = "inherit";

  const readonly = harness === "cursor"
    ? boolValue(frontmatter.readonly)
    : harness === "opencode"
      ? isOpenCodeReadOnly(frontmatter)
      : isClaudeReadOnly(frontmatter);
  if (readonly === true) canonical.readonly = true;

  const background = harness === "cursor"
    ? boolValue(frontmatter.is_background)
    : harness === "claude-code"
      ? boolValue(frontmatter.background)
      : undefined;
  if (background !== undefined) canonical.background = background;

  if (Object.keys(overlay).length > 0) {
    targets[harness] = { ...(isRecord(targets[harness]) ? targets[harness] as Record<string, unknown> : {}), ...overlay };
  }

  const effort = getEffort(overlay, harness);
  addEffortAnalogs(targets, effort, harness);

  const steps = harness === "opencode"
    ? numberValue(frontmatter.steps) ?? numberValue(frontmatter.maxSteps)
    : harness === "claude-code"
      ? numberValue(frontmatter.maxTurns)
      : undefined;
  addStepAnalogs(targets, steps, harness);

  if (Object.keys(targets).length > 0) canonical.targets = targets;

  return {
    name,
    content: serializeMarkdownFrontmatter(canonical, body),
    harness,
  };
}

function codexTargetOverlay(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !CODEX_COMMON_KEYS.has(key))
  );
}

function canonicalizeCodexAgent(raw: string, sourcePath: string): CanonicalizedAgent {
  const config = parseToml(raw);
  const name = stringValue(config.name) ?? slugFromPath(sourcePath);
  const overlay = codexTargetOverlay(config);
  const targets: Record<string, unknown> = {};
  const canonical: Record<string, unknown> = {
    name,
    description: stringValue(config.description) ?? `${name} agent`,
  };

  if (config.model === "inherit") canonical.model = "inherit";
  if (config.sandbox_mode === "read-only") canonical.readonly = true;
  if (Object.keys(overlay).length > 0) targets.codex = overlay;

  const effort = getEffort(config, "codex");
  addEffortAnalogs(targets, effort, "codex");

  if (Object.keys(targets).length > 0) canonical.targets = targets;

  const body = stringValue(config.developer_instructions) ?? "";
  return {
    name,
    content: serializeMarkdownFrontmatter(canonical, `\n${body.trim()}\n`),
    harness: "codex",
  };
}

export function canonicalizeAgentContent(
  raw: string,
  options: CanonicalizeAgentOptions
): CanonicalizedAgent {
  const harness = options.harness ?? inferAgentHarness(options.sourcePath, raw);
  if (harness === "codex") {
    return canonicalizeCodexAgent(raw, options.sourcePath);
  }
  return canonicalizeMarkdownAgent(raw, options.sourcePath, harness);
}
