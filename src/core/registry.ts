/**
 * Core registry — the single source of truth for tools, kinds, transforms,
 * and hooks. Built-ins, YAML kinds, and JS plugins all register here.
 *
 * The singleton `registry` is populated at CLI startup before any command
 * runs. Tests should create a fresh Registry instance rather than using the
 * singleton.
 */

import type {
  Scope,
  OutputMode,
  ResolvedItem,
  ValidationResult,
  CommandContext,
  RenderPlan,
} from "./types.js";

// ---------------------------------------------------------------------------
// OutputMapping — how one (tool, kind) pair renders to a target path
// ---------------------------------------------------------------------------

/** A path template string or scope-specific pair. */
export type PathTemplate = string | { project: string; global: string };

/**
 * Inline transform: accepts raw source content, returns transformed content.
 * Can also be a string that names a registered transform.
 */
export type TransformFn = (raw: string, item?: ResolvedItem) => string;

/** Dynamic output mode selector for mappings that can sometimes symlink. */
export type OutputModeFn = (item: ResolvedItem) => OutputMode;

/**
 * Generator: produces file content from scratch (e.g. CLAUDE.md wrapper).
 * Receives the resolved source item for access to sourcePath / relativePath.
 */
export type GenerateFn = (item: ResolvedItem) => string;

/** How a (tool, kind) pair maps source → target. */
export interface OutputMapping {
  /** Path template. Tokens: {base} {home} {stem} {ext} {name} {relative} {kind} */
  path: PathTemplate;
  /** Override source extension (include the dot). */
  ext?: string;
  /**
   * Output mode. If omitted, inferred:
   *   generate fn present → "generate"
   *   transform present   → "copy"
   *   otherwise           → "symlink"
   */
  mode?: OutputMode | OutputModeFn;
  /** Content transform. Either an inline function or a registered transform name. */
  transform?: TransformFn | string;
  /** Content generator. Mutually exclusive with transform. */
  generate?: GenerateFn;
}

// ---------------------------------------------------------------------------
// KindSpec — describes a class of artifact
// ---------------------------------------------------------------------------

export interface KindSpec {
  /** Unique identifier. Built-ins: "rule", "skill", "instruction". */
  id: string;
  description?: string;
  /**
   * Returns true if a `.loadouts/`-relative path belongs to this kind.
   * Called in insertion order; first match wins.
   */
  detect: (relativePath: string) => boolean;
  /** Whether this artifact is a single file or a directory tree. */
  layout: "file" | "dir";
  /**
   * Fallback output mapping per tool name.
   * Tool-level `targets` overrides these. Primarily used by YAML-defined kinds
   * so custom tools don't need to be updated for every new kind.
   */
  defaultTargets?: Record<string, OutputMapping>;
}

// ---------------------------------------------------------------------------
// ToolSpec — describes an AI tool integration
// ---------------------------------------------------------------------------

export interface ToolSpec {
  /** Unique tool name. E.g. "claude-code", "cursor". */
  name: string;
  /** Root directories where this tool reads config, per scope. */
  basePath: Record<Scope, string>;
  /** Kind IDs this tool supports. Unsupported kinds are silently skipped. */
  supports: string[];
  /**
   * Per-kind output mapping overrides.
   * Takes precedence over `kind.defaultTargets[toolName]`.
   */
  targets?: Record<string, OutputMapping>;
  /** Optional prerequisite validator called by `loadout check`. */
  validate?: (scope: Scope) => Promise<ValidationResult>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type HookEvent =
  | "pre-apply"
  | "post-apply"
  | "pre-render"
  | "post-render"
  | "pre-clean"
  | "post-clean";

export type HookFn = (
  ctx: CommandContext,
  plan: RenderPlan
) => Promise<void>;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class Registry {
  private _kinds = new Map<string, KindSpec>();
  private _tools = new Map<string, ToolSpec>();
  private _transforms = new Map<string, TransformFn>();
  private _hooks = new Map<HookEvent, HookFn[]>();

  // ── Registration ──────────────────────────────────────────────────────────

  registerKind(spec: KindSpec): void {
    if (this._kinds.has(spec.id)) {
      throw new Error(`Kind "${spec.id}" is already registered.`);
    }
    this._kinds.set(spec.id, spec);
  }

  registerTool(spec: ToolSpec): void {
    if (this._tools.has(spec.name)) {
      throw new Error(`Tool "${spec.name}" is already registered.`);
    }
    this._tools.set(spec.name, spec);
  }

  registerTransform(name: string, fn: TransformFn): void {
    this._transforms.set(name, fn);
  }

  registerHook(event: HookEvent, fn: HookFn): void {
    const list = this._hooks.get(event) ?? [];
    this._hooks.set(event, [...list, fn]);
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  getKind(id: string): KindSpec | undefined {
    return this._kinds.get(id);
  }

  getTool(name: string): ToolSpec | undefined {
    return this._tools.get(name);
  }

  getTransform(name: string): TransformFn | undefined {
    return this._transforms.get(name);
  }

  getHooks(event: HookEvent): HookFn[] {
    return this._hooks.get(event) ?? [];
  }

  allKinds(): KindSpec[] {
    return [...this._kinds.values()];
  }

  allTools(): ToolSpec[] {
    return [...this._tools.values()];
  }

  allToolNames(): string[] {
    return [...this._tools.keys()];
  }

  // ── Inference & resolution ────────────────────────────────────────────────

  /**
   * Return the first registered kind whose `detect` predicate matches the
   * given `.loadouts/`-relative path, or undefined if none matches.
   */
  inferKind(relativePath: string): string | undefined {
    for (const kind of this._kinds.values()) {
      if (kind.detect(relativePath)) return kind.id;
    }
    return undefined;
  }

  /**
   * Resolve the output mapping for a (tool, kind) pair.
   *
   * Precedence: tool.targets[kindId] > kind.defaultTargets[toolName]
   *
   * A tool's explicit `supports` list governs its own target overrides.
   * A kind's `defaultTargets` implicitly extends support to any listed tool,
   * enabling YAML-defined kinds to work with existing tools without requiring
   * those tools to be modified.
   *
   * Returns undefined if no mapping exists for the combination.
   */
  resolveMapping(
    toolName: string,
    kindId: string
  ): OutputMapping | undefined {
    const tool = this._tools.get(toolName);
    const kind = this._kinds.get(kindId);
    if (!tool || !kind) return undefined;

    // Tool-level override — only applies when the tool explicitly supports the kind
    if (tool.supports.includes(kindId) && tool.targets?.[kindId]) {
      return tool.targets[kindId];
    }

    // Kind-level default — implicitly extends support for listed tools
    if (kind.defaultTargets?.[toolName]) {
      return kind.defaultTargets[toolName];
    }

    // Tool supports the kind but has no specific mapping (treated as pass-through)
    if (tool.supports.includes(kindId)) {
      return undefined;
    }

    return undefined;
  }
}

/** Module singleton — populated at startup, shared across all commands. */
export const registry = new Registry();
