# Loadouts CLI Visual Language

This document defines the unified visual language for all loadouts CLI output. Follow these patterns when adding or modifying commands to maintain consistency.

## Core Principle

**Artifact-first, tool-secondary.**

- **Vertical axis (rows)** → Artifacts (what the user cares about)
- **Horizontal axis (columns)** → Tools (where artifacts go)
- **Cell content** → Status indicators

Users should always be able to:
1. Scan rows to see what artifacts are involved
2. Scan columns to see which tools are affected
3. Read cells to understand what's happening

## Standard Table Format

All commands that display artifact information should use this columnar format:

```
  kind         artifact         claude-code  cursor  opencode  codex  pi
  ───────────  ───────────────  ───────────  ──────  ────────  ─────  ──
  instruction  AGENTS           ✓            ✓       ✓         ✓      ✓
  skill        managing-memory  ✓            ✓       ✓         ✓      ✓
  extension    tmux-fork.ts     —            —       —         —      ✓
```

### Column Order
1. `kind` — artifact kind (instruction, rule, skill, extension, etc.)
2. `artifact` — display name (not full path)
3. Additional context columns (tokens, mode, action) — optional, command-specific
4. Tool columns — one per tool, in canonical order: `claude-code`, `cursor`, `opencode`, `codex`, `pi`
5. Status column — optional, for overall row status

### Column Widths
- `kind`: dynamic, min 4 chars
- `artifact`: dynamic, max 35 chars (truncate with leading `…`)
- Tool columns: width of tool name, min 2 chars
- Token columns: 7 chars, right-aligned

## Status Indicators

Use these symbols consistently across all commands:

| Symbol | Color  | Meaning                    | Used In              |
|--------|--------|----------------------------|----------------------|
| `✓`    | green  | in-sync, ok, applicable    | status, info         |
| `+`    | green  | added, created             | activate, sync, diff |
| `~`    | yellow | modified, updated          | activate, sync, diff |
| `-`    | red    | removed, deleted           | activate, sync, diff |
| `!`    | red    | missing, error             | status               |
| `!`    | red    | held: local edits block write | activate, sync    |
| `?`    | yellow | shadowed (blocked)         | status, activate     |
| `⚡`    | yellow | unlinked (symlink broken)  | status               |
| `💀`    | red    | broken (unrecoverable)     | status               |
| `—`    | dim    | not applicable             | info, status         |
| `▸`    | green  | active loadout             | list, info           |
| `•`    | dim    | global scope               | info                 |
| `◦`    | cyan   | local/project scope        | info                 |
| `→`    | yellow | external source            | info                 |

**Cell semantics:** Use `—` for not-applicable tool cells (never leave cells blank).

### In Table Cells
- Symbols are left-aligned in their column
- Pad with spaces to maintain column width
- Use chalk colors for terminal output

## Command-Specific Formats

### `info` — Show loadout information

Displays a unified table of all active loadouts with artifacts grouped by loadout.
Scope is indicated with subtle symbols after the loadout name.

```
Active loadouts
───────────────
  loadout    kind         artifact         upfront     lazy  claude-code  cursor  ...
  ─────────  ───────────  ───────────────  ───────  ───────  ───────────  ──────  ...
  ▸ base •   instruction  AGENTS.base.md       968        —  ✓            ✓       ...
             skill        managing-memory       94     1.4k  ✓            ✓       ...
             extension    tmux-fork.ts           —        —                       ...
  ▸ base ◦   instruction  AGENTS.base.md       641        —  ✓            ✓       ...

  Upfront: 1.7k • Lazy: 1.4k • Total: 3.1k tokens
  • global  ◦ local  →name source
```

Scope indicators:
- `•` (dim) — global scope
- `◦` (cyan) — local/project scope  
- `→name` (yellow) — external source (shows source name)

The `▸` marker (green) indicates active loadouts.
Loadout name only appears on the first row of each group.
Token columns appear when any artifact has context tokens.

### `status` — Show drift status

Unified table matching `info`, with an additional status column showing drift.

```
Loadout status
──────────────
  loadout    kind         artifact         claude-code  cursor  ...  status
  ─────────  ───────────  ───────────────  ───────────  ──────  ...  ────────
  ▸ base ◦   instruction  AGENTS.base.md   ✓            ✓       ...  ok
  ▸ base •   instruction  AGENTS.base.md   ✓            ✓       ...  ok
             skill        managing-memory  ✓            ✓       ...  ok
             extension    tmux-fork.ts                          ...  ok

  • global  ◦ local

✓ All in sync
```

Status column shows the worst drift status across all tools for that artifact.
Drift indicators (worst to best): `💀` broken > `!` missing > `⚡` unlinked > `~` modified > `✓` ok.

### `activate` / `sync` / `deactivate` — Apply changes
```
Activated loadouts: base (global)
─────────────────────────────────
  kind         artifact         claude-code  cursor  opencode  codex  pi
  ───────────  ───────────────  ───────────  ──────  ────────  ─────  ──
  instruction  AGENTS           +            +       +         +      +
  skill        managing-memory  +            +       +         +      +

✓ 8 changes: 5 added, 2 updated, 1 removed
```

### `activate --dry-run` — Preview changes
```
Would apply loadouts: base (global)
───────────────────────────────────
  kind         artifact         claude-code  cursor  opencode  codex  pi
  ───────────  ───────────────  ───────────  ──────  ────────  ─────  ──
  instruction  AGENTS           generate     sym     sym       sym    sym
  skill        managing-memory  sym          sym     sym       sym    sym

  8 outputs to 5 tools
```

Mode abbreviations: `sym` = symlink, `generate` = generate, `copy` = copy

### `diff` — Show pending changes
```
Diff: base (global)
───────────────────
  kind         artifact         claude-code  cursor  opencode  codex  pi  action
  ───────────  ───────────────  ───────────  ──────  ────────  ─────  ──  ──────
  instruction  AGENTS           +            +       +         +      +   create
  skill        managing-memory  ~            ~       ~         ~      ~   update
  rule         old-rule         -            -       -         -      -   delete
```

### `list` — List available loadouts

Shows all available loadouts with scope indicators matching `info`.

```
Available loadouts
──────────────────
  loadout           items  description
  ────────────────  ─────  ──────────────────────────────
  ▸ base       * ◦      1  Base loadout configuration
  ▸ base         •      3  Global base configuration
    meta         •     11  Meta loadout configuration

  ▸ active  * default
  • global  ◦ local  →name source
```

Loadout column format: `▸ name * scope` where:
- `▸` (green) — active loadout
- `*` (cyan) — default loadout (project scope only)
- Scope indicators match `info` (• global, ◦ local, →name source)

## Headings and Separators

### Section Headings
```typescript
heading("Global loadout: base");
// Output:
// 
// Global loadout: base
// ────────────────────
```

- Blank line before heading
- Title in bold
- Separator line matches title length (dim)

### Key-Value Metadata
```typescript
keyValue({
  Description: "My loadout",
  Root: "/path/to/root",
});
// Output:
//   Description: My loadout
//   Root: /path/to/root
```

- 2-space indent
- Key in dim, followed by colon and space
- Value in normal color

## Log Messages

Use the standard log helpers:

```typescript
log.success("8 changes applied");     // ✓ 8 changes applied (green)
log.info("Checking prerequisites");   // ℹ Checking prerequisites (blue)
log.warn("3 files shadowed");         // ⚠ 3 files shadowed (yellow)
log.error("Failed to resolve");       // ✗ Failed to resolve (red)
log.dim("Run 'loadouts sync' to fix"); // (dimmed text)
```

## Implementation

### Shared Utilities (`src/lib/artifact-table.ts`)

- `getArtifactName()` — extract display name from path
- `sortArtifacts()` — sort by kind priority, then name
- `truncatePath()` — truncate with leading ellipsis
- `getToolColumns()` — calculate tool column specs
- `calculateColumnWidths()` — dynamic column sizing
- `renderArtifactTable()` — base table renderer

### Output Helpers (`src/lib/output.ts`)

- `heading()` — section heading with separator
- `keyValue()` — key-value pair list
- `list()` — bulleted list
- `log.*` — status messages

## Adding New Commands

When adding a new command that displays artifact information:

1. Use the artifact table format with tools as columns
2. Use standard status indicators
3. Follow the heading/separator patterns
4. Use `log.*` for status messages
5. Add any new columns between artifact and tool columns

When in doubt, look at `info` and `status` as reference implementations.
