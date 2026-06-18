/**
 * Core type definitions for Loadout.
 *
 * Tool and ArtifactKind are open strings backed by the registry at runtime.
 * Use registry.getTool() / registry.getKind() to validate at call sites where
 * correctness matters. Compile-time exhaustiveness checking is traded for
 * extensibility — the registry provides equivalent runtime validation.
 */

// Scope of loadout application
export type Scope = "global" | "project";

// Open string types backed by the registry.
// Built-in tools: "claude-code" | "cursor" | "opencode" | "codex" | "pi"
// Built-in kinds include "rule", "skill", "instruction", and tool-specific
// artifact kinds such as "opencode-config", "opencode-tui-config", and
// "opencode-plugin".
export type Tool = string;
export type ArtifactKind = string;

// Output modes
export type OutputMode = "symlink" | "copy" | "generate";

// Source reference — path to another .loadouts/ directory
export type SourceRef = string;

// Root config (.loadouts/loadouts.yaml)
export interface RootConfig {
  version: "1";
  default?: string;
  mode?: OutputMode;
  tools?: Tool[];
  sources?: SourceRef[];  // Paths to other .loadouts/ directories
}

// Loadout definition (.loadouts/loadouts/<name>.yaml)
export interface LoadoutDefinition {
  name: string;
  description?: string;
  tools?: Tool[];
  include: LoadoutInclude[];
}

// Include entry — either a plain path string or a path with per-include tool override
export type LoadoutInclude =
  | string
  | { path: string; tools?: Tool[] };

// Resolved include item
export interface ResolvedItem {
  kind: ArtifactKind;
  sourcePath: string;    // Absolute path to source file/directory
  relativePath: string;  // Path relative to .loadouts/ root
  tools: Tool[];         // Active tools for this item
}

// Resolved loadout (after merging active loadouts)
export interface ResolvedLoadout {
  name: string;
  description?: string;
  tools: Tool[];
  items: ResolvedItem[];
  rootPath: string;        // Absolute path to the owning .loadouts/ directory
}

// Output spec produced by the renderer for one (item, tool) pair
export interface OutputSpec {
  tool: Tool;
  kind: ArtifactKind;
  sourcePath: string;
  /** Relative path from project root, or absolute for global scope outputs. */
  targetPath: string;
  mode: OutputMode;
}

// Rendered content + hash for one output spec
export interface RenderedOutput {
  content: string;  // File content (dir-layout items are expanded to individual files)
  hash: string;
}

// Manifest entry stored in .loadouts/.state.json
export interface ManifestEntry {
  tools: Tool[];        // All tools that share this output path
  kind: ArtifactKind;
  sourcePath: string;
  targetPath: string;
  mode: OutputMode;
  renderedHash: string;
}

// An output skipped because an unmanaged file already occupies the target
export interface ShadowedEntry {
  tool: Tool;
  kind: ArtifactKind;
  sourcePath: string;
  targetPath: string;
}

// Applied state persisted to .loadouts/.state.json
export interface AppliedState {
  active: string[];     // Set of active loadout names
  mode: OutputMode;
  appliedAt: string;    // ISO timestamp
  entries: ManifestEntry[];
  shadowed: ShadowedEntry[];
}

// A discovered .loadouts/ root directory
export interface LoadoutRoot {
  path: string;          // Absolute path to .loadouts/ directory
  level: "project" | "source" | "global" | "bundled";
  depth: number;         // 0 = current dir, higher = further up tree / source chain
  sourceRef?: string;    // Original source reference (for debugging/display)
}

// Command execution context — built by getContext()
export interface CommandContext {
  scope: Scope;
  configPath: string;    // Absolute path to .loadouts/ or ~/.config/loadouts
  statePath: string;     // Absolute path to .state.json within configPath
  projectRoot: string;   // Where outputs are applied (cwd for project, home for global)
}

// Validation result returned by tool validators
export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

// Plan produced by planRender() — shared across render.ts, registry.ts, commands
export interface RenderPlan {
  outputs: Array<{
    spec: OutputSpec;
    item: ResolvedItem;
    hash: string;        // renderedHash, stored in state on apply
  }>;
  errors: string[];
  shadowed: ShadowedEntry[];
}
