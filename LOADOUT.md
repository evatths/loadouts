# Loadouts

**Composable configuration bundles for AI coding agents.**

Loadouts organizes your rules, skills, and instructions into named **loadouts** that you can mix and match:

- **Task-specific configs** — Activate `backend` for API work, `frontend` for UI work, or both together
- **Team flexibility** — Track all available configs in one place; each teammate activates what they need
- **Tool portability** — Write once, apply to Claude Code, Cursor, OpenCode, Codex, and Pi

```bash
loadouts activate base backend     # Backend task
loadouts activate base frontend    # Switch to frontend
loadouts activate base backend ml  # Combine multiple loadouts
```

---

## Quick Start

**New project:**
```bash
loadouts init                      # Initialize .loadouts/
loadouts create backend -e base    # Create loadout extending base
loadouts rule add api-standards    # Add rules to it
loadouts activate backend          # Activate it
```

**Existing project with configs:**
```bash
loadouts init                      # Initialize .loadouts/ (auto-detects existing configs)
loadouts install                   # Or run separately to import existing configs
loadouts install ./agent-pack      # Or import from a source directory
loadouts sync                      # Apply unified config
```

---

## Importing Existing Configuration

If you already have rules, skills, or instruction files scattered across tool directories, `loadouts install` discovers and imports them all at once. You can also pass a file or directory to import from one specific source.

```bash
loadouts install                   # Discover and import all existing configs
loadouts install ./agent-pack      # Import from a source directory
loadouts install ./rule.mdc        # Import a single artifact
loadouts install --dry-run         # Preview what would be imported
loadouts install -i                # Interactive selection mode
loadouts install --rules           # Only import rules
loadouts install --from cursor     # Only from Cursor directories
loadouts install --keep            # Keep original files after import
```

**Auto-detection on init:** When you run `loadouts init`, it automatically detects existing configurations and offers to import them.

**What gets discovered:**
- Rules from `.claude/rules/`, `.cursor/rules/`, `.opencode/rules/`
- Skills from `.claude/skills/`, `.cursor/skills/`, `.opencode/skills/`, `.agents/skills/`, `.pi/skills/`
- Instruction files (`AGENTS.md`, `CLAUDE.md`) at project root

**Source installs:** When a path is provided, Loadouts imports from that specific source. Source directories may contain canonical `rules/`, `skills/`, and `instructions/` folders, direct skill directories with `SKILL.md`, single rule files, or registry-mapped tool artifacts such as `.opencode/plugins/*.ts`.

**Conflict resolution:** When the same artifact exists in multiple tool directories, `loadouts install` detects the conflict and lets you choose which version to import (or import both with renamed destinations).

**Manual import:** For individual files, you can still use the granular import commands:

```bash
loadouts rule import .cursor/rules/coding-style.mdc
loadouts skill import .claude/skills/debugging
loadouts instructions import
```

Imported artifacts are:
1. Copied into `.loadouts/rules/` or `.loadouts/skills/`
2. Automatically added to the `base` loadout (use `--to <name>` to change)
3. Original files deleted by default (use `--keep` to preserve)

After importing, run `loadouts sync` to render outputs to all tool directories.

---

## Installation

```bash
npm install -g loadouts
```

Requires Node.js 18+.

---

## Core Concepts

### The `.loadouts/` Directory

Loadout stores all configuration in a `.loadouts/` directory:

```
.loadouts/
├── loadout.yaml          # Root config (version, defaults)
├── loadouts/             # Named configuration bundles
│   └── base.yaml
├── instructions/         # Per-loadout instruction files
│   └── AGENTS.base.md    # Instructions for base loadout
├── rules/                # Portable rule files
└── skills/               # Portable skill directories
```

### Scopes

Loadout operates in two scopes:

| Scope | Location | Flag | Purpose |
|-------|----------|------|---------|
| **Project** | `./.loadouts/` | `-l` | Project-specific config |
| **Global** | `~/.config/loadouts/` | `-g` | User-wide config |

Most commands auto-detect scope. Use `-l`/`-g` to be explicit, or `-a` to target both.

### Loadouts

A **loadout** is a named bundle of artifacts. Loadouts can extend other loadouts for composition:

```yaml
# .loadouts/loadouts/backend.yaml
name: backend
description: Backend development configuration
extends: base

include:
  - rules/go.md
  - rules/database.md
  - skills/deploy
```

**Inheritance:** When a loadout extends another, items are merged with the child's items taking precedence. The extends chain is resolved in order (child → parent → grandparent).

**Multiple active loadouts:** You can activate multiple loadouts simultaneously. Their outputs are merged, with earlier loadouts taking precedence on conflicts:

```bash
loadouts activate base backend ml    # All three active
loadouts deactivate ml               # Remove just ml
```

**Per-include tool overrides:** Target specific tools for individual artifacts:

```yaml
include:
  - rules/general.md                      # All tools
  - path: rules/cursor-only.md
    tools: [cursor]                       # Cursor only
  - path: skills/claude-debug
    tools: [claude-code, pi]              # Multiple specific tools
```

### Sources: Cross-Project Configuration

Loadout supports sharing configuration across projects via **sources**. Declare paths to other `.loadouts/` directories in your `loadout.yaml`:

```yaml
# packages/api/.loadouts/loadouts.yaml
version: "1"
default: api

sources:
  - ../..                    # Parent monorepo .loadouts/
  - ../../shared/configs     # Sibling shared config directory
  - ~/dotfiles               # Personal global config (~ expands to home)
```

When resolving loadouts, sources are searched in declaration order after the local `.loadouts/`. This enables:

- **Monorepo inheritance** — Subprojects pull rules/skills from the repo root
- **Shared config libraries** — Reference a common config directory
- **Bi-directional sharing** — Parent can also source from children for umbrella loadouts

**Resolution order:**
1. Local `.loadouts/` (highest priority)
2. Sources in declaration order (transitively followed)
3. Global `~/.config/loadouts/` (lowest priority)

Nearest wins on name conflicts. A subproject loadout can `extends: base` to inherit from a parent's base loadout.

**Example: Monorepo structure**

```
~/code/monorepo/
├── .loadouts/                       # repo-level config
│   ├── loadout.yaml
│   ├── loadouts/base.yaml          # Shared base loadout
│   ├── rules/shared-style.md       # Shared rules
│   └── skills/debugging/           # Shared skills
├── packages/
│   └── api/
│       ├── .loadouts/
│       │   ├── loadout.yaml        # sources: [../..]
│       │   └── loadouts/api.yaml   # extends: base
│       └── src/
```

With `sources: [../..]` in `packages/api/.loadouts/loadouts.yaml`, running `loadouts sync` in the api package will:
1. Resolve the `api` loadout (which extends `base` from the parent)
2. Include parent's `rules/shared-style.md` and `skills/debugging/`
3. Render all artifacts to `packages/api/.cursor/`, `packages/api/.claude/`, etc.

**Missing sources:** If a source path doesn't resolve, loadouts logs a warning and continues. Use `loadouts list` to see available loadouts and any source warnings.

**Cycle detection:** Loadout detects circular source references and skips duplicates automatically.

### Artifact Kinds

**Built-in kinds:**

| Kind | Layout | Description |
|------|--------|-------------|
| `rule` | file | Scoped advisory rules (`.md`) |
| `skill` | directory | On-demand capabilities with `SKILL.md` |
| `instruction` | file | Always-on project instructions (`AGENTS.md`) |
| `prompt` | file | Slash command templates |
| `extension` | directory | Runtime code extensions |
| `theme` | file | UI theme configuration |

### Custom Artifact Kinds

Define custom artifact types by adding YAML files to `.loadouts/kinds/`. This lets you manage any directory of files across tools without writing code.

**Example:** Share a `prompts/` directory across tools:

```yaml
# .loadouts/kinds/prompt.yaml
id: myteam.prompt
description: Reusable prompt snippets shared across tools.

detect:
  pathPrefix: prompts/      # Match files in .loadouts/prompts/

layout: file                 # One source file → one output file

targets:                     # Per-tool output paths
  claude-code:
    path: "{base}/prompts/{stem}{ext}"
  cursor:
    path: "{base}/prompts/{stem}.mdc"
    ext: .mdc                # Cursor wants .mdc extension
  opencode:
    path: "{base}/prompts/{stem}{ext}"
  # Tools not listed ignore this kind
```

After adding this file, create `.loadouts/prompts/my-prompt.md`, include it in a loadout, and `loadouts sync` renders it to each tool's directory.

**Path templates:**
- `{base}` — Tool's base directory (e.g., `.claude`, `.cursor`)
- `{stem}` — Filename without extension
- `{ext}` — Source file extension
- `{name}` — Directory name (for `layout: dir`)

**Detection options:**
```yaml
detect:
  pathPrefix: prompts/      # Match paths starting with prefix
# or
detect:
  pathExact: AGENTS.md      # Match exact path
```

**Naming convention:** Use dot-namespaced IDs (e.g., `myteam.prompt`) to avoid collisions with built-ins.

List all registered kinds with `loadouts kinds -v`.

### Supported Tools

| Tool | Rules | Skills | Instructions | Extra Artifacts |
|------|-------|--------|--------------|-----------------|
| Claude Code | `.claude/rules/*.md` | `.claude/skills/` | `CLAUDE.md` (generated wrapper) | — |
| Cursor | `.cursor/rules/*.mdc` | `.cursor/skills/` | `AGENTS.md` | — |
| OpenCode | `.opencode/rules/*.md` | `.opencode/skills/` | `AGENTS.md` | `opencode.json(c)`, `.opencode/plugins/` |
| Codex | — | `.agents/skills/` | `AGENTS.md` | — |
| Pi | `.pi/rules/*.md` | `.pi/skills/` | `AGENTS.md` | `.pi/extensions/`, `.pi/themes/` |

**Tool-specific notes:**

- **Claude Code** — Generates a `CLAUDE.md` wrapper that references `AGENTS.md`, keeping both in sync.
- **Cursor** — Rules use `.mdc` extension. Loadout automatically converts `paths` ↔ `globs` in frontmatter.
- **OpenCode** — Local plugins render to `.opencode/plugins/`. NPM plugins are configured with the `plugin` array in `opencode.json(c)`.
- **Codex** — Rules not yet supported; skills and instructions only.

---

## Commands

### Active Configuration

Commands for managing what's currently applied.

#### `loadouts info [name]`

Show detailed loadout information including artifacts, tools, and token estimates.

```bash
loadouts info              # Show active loadout(s)
loadouts info backend      # Show specific loadout
loadouts info -g           # Show global loadout
```

The output shows a table with:
- **kind** — Artifact type (rule, skill, instruction)
- **artifact** — Relative path in `.loadouts/`
- **upfront** — Tokens loaded at session start
- **lazy** — Tokens loaded on-demand (skills only)
- **tool columns** — Which tools receive each artifact (✓)

#### `loadouts activate <names...>`

Add loadout(s) to the active set and render outputs.

```bash
loadouts activate backend              # Activate backend loadout
loadouts activate base frontend        # Activate multiple loadouts
loadouts activate ml -g                # Activate global loadout
loadouts activate backend --dry-run    # Preview changes
```

#### `loadouts deactivate <names...>`

Remove loadout(s) from the active set.

```bash
loadouts deactivate backend            # Deactivate backend
loadouts deactivate backend --dry-run  # Preview changes
```

#### `loadouts clear`

Deactivate all loadouts and remove all outputs.

```bash
loadouts clear             # Clear project scope
loadouts clear -g          # Clear global scope
loadouts clear -a          # Clear both scopes
loadouts clear --dry-run   # Preview what would be removed
```

#### `loadouts status`

Show drift status for active loadouts. Detects:
- **Config drift** — Loadout definition changed (items added/removed)
- **Output drift** — Managed files modified, missing, or unlinked

```bash
loadouts status            # Check all scopes
loadouts status -l         # Project only
```

#### `loadouts sync`

Re-render active loadouts from latest definitions. Use after editing rules or skills.

```bash
loadouts sync              # Sync all scopes
loadouts sync -l           # Project only
loadouts sync --dry-run    # Preview changes
```

---

### Loadout Management

Commands for creating and managing loadout definitions.

#### `loadouts init`

Initialize a new loadout directory.

```bash
loadouts init              # Initialize .loadouts/ in current directory
loadouts init -g           # Initialize ~/.config/loadouts/
loadouts init --force      # Overwrite existing
```

Creates the directory structure, a `base` loadout, and applies it automatically. If existing tool configurations are detected, offers to import them.

#### `loadouts install [source]`

Discover and import existing tool configurations into loadout. When `source` is provided, import from that file or directory instead of scanning the current tool config directories.

```bash
loadouts install                   # Discover all, prompt before importing
loadouts install ./agent-pack      # Import from a source directory
loadouts install ./rule.mdc        # Import a single artifact
loadouts install --dry-run         # Preview what would be imported
loadouts install -i                # Interactive selection mode
loadouts install -y                # Auto-confirm (import all, resolve conflicts automatically)
loadouts install --rules           # Only import rules
loadouts install --skills          # Only import skills
loadouts install --from cursor     # Only from specific tool directories
loadouts install --keep            # Keep original files (don't delete after import)
loadouts install --to staging      # Add to a specific loadout instead of base
```

Without a source path, scans all known tool directories (`.claude/`, `.cursor/`, `.opencode/`, `.agents/`, `.pi/`) for rules, skills, and instruction files. Detects naming conflicts when the same artifact exists in multiple locations.

#### `loadouts create <name>`

Create a new loadout definition.

```bash
loadouts create backend                        # Create project loadout
loadouts create ml -g                          # Create global loadout
loadouts create api -e base                    # Extend another loadout
loadouts create test -d "Testing config"       # With description
loadouts create backend --no-edit              # Don't open in editor
```

#### `loadouts edit <name>`

Open a loadout definition in `$EDITOR`.

```bash
loadouts edit backend      # Edit project loadout
loadouts edit base -g      # Edit global loadout
```

#### `loadouts remove [name]`

Remove applied loadout outputs (deletes rendered files).

```bash
loadouts remove            # Remove all applied outputs
loadouts remove backend    # Validate name before removing
loadouts remove --dry-run  # Preview what would be removed
```

#### `loadouts list`

List available loadouts.

```bash
loadouts list              # List all scopes
loadouts list -l           # Project only
loadouts list -g           # Global only
```

Shows name, item count, description, and inheritance chain.

#### `loadouts check`

Validate loadout configuration.

```bash
loadouts check             # Check all scopes
loadouts check -v          # Verbose output
```

Validates:
- YAML syntax
- All referenced files exist
- No circular extends
- Tool prerequisites satisfied
- No unmanaged file collisions

#### `loadouts diff [name]`

Preview what would change if a loadout were applied.

```bash
loadouts diff              # Diff default loadout
loadouts diff backend      # Diff specific loadout
```

Shows files to create, update, or delete.

---

### Artifact Authoring

Commands for creating and managing rules, skills, and instructions.

#### Rules

Rules are scoped advisory files that apply to specific file patterns.

```bash
# Create a rule
loadouts rule add my-rule
loadouts rule add go-style -g                   # Global rule
loadouts rule add api -d "API guidelines"       # With description
loadouts rule add test -p "**/*.test.ts"        # With paths
loadouts rule add strict --always-apply         # Always apply

# List rules
loadouts rule list
loadouts rule list -g

# Edit a rule
loadouts rule edit my-rule
loadouts rule edit go-style -g

# Remove a rule
loadouts rule remove my-rule
loadouts rule remove old-rule -g --force

# Import existing rule file
loadouts rule import ./CLAUDE.md
loadouts rule import ./.cursor/rules/code.mdc --keep
```

Rule files use YAML frontmatter:

```markdown
---
description: Go coding standards
paths: ["**/*.go"]
alwaysApply: false
---

# Go Standards

Use errors.Join() for error wrapping.
```

#### Skills

Skills are directories with a `SKILL.md` and optional supporting files.

```bash
# Create a skill
loadouts skill add deploy
loadouts skill add debug -g                      # Global skill
loadouts skill add test -d "Testing utilities"   # With description

# List skills
loadouts skill list
loadouts skill list -a                           # All scopes

# Edit a skill
loadouts skill edit deploy
loadouts skill edit debug -g

# Remove a skill
loadouts skill remove deploy
loadouts skill remove old-skill -g --force

# Import existing skill directory
loadouts skill import ./my-skill
loadouts skill import ~/.claude/skills/debug -g --keep
```

Skill structure:

```
skills/deploy/
├── SKILL.md              # Required: description and instructions
├── references/           # Optional: supporting documents
└── scripts/              # Optional: executable scripts
```

#### Instructions

Each loadout can have its own instruction file at `.loadouts/instructions/AGENTS.<loadout>.md`. The active loadout's instructions are rendered to `AGENTS.md` at project root.

```bash
# Create instruction file for a loadout
loadouts instructions init              # For active loadout (default: base)
loadouts instructions init backend      # For specific loadout
loadouts instructions init --force      # Overwrite existing

# Edit instruction file
loadouts instructions edit              # Edit active loadout's instructions
loadouts instructions edit backend      # Edit specific loadout's instructions

# List instruction files
loadouts instructions list

# Import existing instruction file
loadouts instructions import            # Auto-detect AGENTS.md or CLAUDE.md
loadouts instructions import --to backend  # Import to specific loadout
loadouts instructions import ./docs/AGENTS.md --keep
```

#### Kinds

List all registered artifact kinds.

```bash
loadouts kinds             # List built-in and custom kinds
loadouts kinds -v          # Show detection rules and tool mappings
```

---

## Configuration Reference

### Root Config: `loadout.yaml`

```yaml
version: "1"              # Required: config version
default: base             # Default loadout to apply
mode: symlink             # Output mode: symlink | copy | generate
tools:                    # Tools to target (default: all)
  - claude-code
  - cursor
  - opencode
sources:                  # Other .loadouts/ directories to include
  - ../..                 # Relative path (to directory containing .loadouts/)
  - ~/shared/configs      # Absolute or ~ paths supported
```

### Loadout Definition: `loadouts/<name>.yaml`

```yaml
name: backend                           # Required: loadout name
description: Backend configuration      # Optional: description
extends: base                           # Optional: inherit from another loadout

tools:                                  # Optional: override default tools
  - claude-code
  - opencode

include:                                # Required: list of artifacts
  - rules/go.md                         # Simple path
  - skills/deploy                       # Skill directory
  - path: rules/cursor-only.md          # With per-item options
    tools: [cursor]
```

### State File: `.loadouts/.state.json`

Internal file tracking applied state. Automatically managed; do not edit manually.

### Skill Format: `SKILL.md`

Skills require a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: debugging
description: Advanced debugging techniques for Python applications.
---

# Debugging Skill

## When to Use

Invoke this skill when the user needs help debugging...

## Instructions

1. First, identify the error type...
2. Check the stack trace...

## Examples

...
```

**Required frontmatter:**
- `name` — Skill identifier
- `description` — Brief description (this is the "upfront" token cost)

**Optional structure:**
```
skills/debugging/
├── SKILL.md              # Required
├── references/           # Supporting documents (loaded lazily)
│   └── error-codes.md
└── scripts/              # Executable helpers
    └── analyze.sh
```

---

## Git and Team Workflows

### Automatic Gitignore Management

Loadout automatically manages your `.gitignore` to exclude only the specific files it creates. This means:

- **Tool directories stay usable** — You can have custom settings in `.cursor/`, `.claude/`, etc.
- **Only managed paths are ignored** — Loadout tracks exactly what it writes
- **Custom artifacts coexist** — Add your own rules/skills alongside loadout-managed ones

When you run `loadouts sync` or `loadouts activate`, loadout adds a managed section to `.gitignore`:

```gitignore
# <loadout>
# Auto-generated by loadout. Do not edit this section.
.loadouts/.state.json
.cursor/rules/coding-style.mdc
.cursor/skills/debug/SKILL.md
.cursor/skills/debug/references/errors.md
.claude/rules/coding-style.md
.claude/skills/debug/SKILL.md
.claude/skills/debug/references/errors.md
CLAUDE.md
# </loadout>
```

This section is automatically updated when you add or remove artifacts.

**What gets committed:**
- `.loadouts/` directory (your source configs)
- `AGENTS.md` at project root (canonical instructions)
- `.gitignore` (including the managed section)

**What stays local:**
- All paths listed in the `# <loadout>` section
- The `.loadouts/.state.json` state file

### Custom Tool Configs

Because loadout only ignores specific paths, you can safely add custom configurations that loadout doesn't manage:

```
.cursor/
├── rules/
│   ├── coding-style.mdc    # Managed by loadout (ignored)
│   └── my-custom.mdc       # Your custom rule (committed)
├── skills/
│   ├── debug/              # Managed by loadout (ignored)
│   └── my-skill/           # Your custom skill (committed)
└── mcp.json                # Tool settings (committed)
```

Loadout's shadowing behavior ensures it never overwrites unmanaged files.

### Team Onboarding

Loadout creates two mechanisms for automatic sync on clone/pull:

**Option 1: Git hooks** (recommended)

After cloning, team members run once:
```bash
git config core.hooksPath .loadouts/hooks
```

This enables automatic sync on `git checkout` and `git pull`. For JS projects, add to `package.json` to automate:
```json
{
  "scripts": {
    "prepare": "git config core.hooksPath .loadouts/hooks 2>/dev/null || true"
  }
}
```

**Option 2: Direnv**

If your team uses [direnv](https://direnv.net/), team members run once:
```bash
direnv allow
```

This enables automatic sync when entering the project directory.

**Manual fallback:**
```bash
loadouts sync              # Regenerates all outputs from .loadouts/
```

The hooks and `.envrc` gracefully skip if loadout isn't installed, so they won't break anything for users without it.

### CI/CD

In CI, either:
1. **Skip loadout entirely** — AI tools aren't used in CI
2. **Run `loadouts sync`** — If your CI uses AI tools for code review

---

## Output Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `symlink` | Target symlinks to source | Default; edits stay in sync |
| `copy` | Target is a managed copy | When tools don't follow symlinks |
| `generate` | Target is rendered/wrapped | Tool-specific transformations |

---

## Scope Flags

All commands support consistent scope flags:

| Flag | Description |
|------|-------------|
| `-l, --local` | Project scope only |
| `-g, --global` | Global scope only |
| `-a, --all` | Both scopes |
| (none) | Auto-detect or default |

---

## Common Workflows

### New Project

```bash
loadouts init
loadouts rule add coding-standards
loadouts sync
```

### Migrating Existing Project

```bash
loadouts init
loadouts instructions import              # Grabs AGENTS.md or CLAUDE.md
loadouts rule import .cursor/rules/*.mdc  # Import Cursor rules
loadouts skill import .claude/skills/*    # Import Claude skills
loadouts check                            # Validate
loadouts sync                             # Render to all tools
```

### Adding Global Config

```bash
loadouts init -g
loadouts rule add -g my-style
loadouts activate base -g
```

### Checking for Drift

```bash
loadouts status      # See what changed
loadouts sync        # Reconcile
```

---

## Shadowed Files

A **shadowed file** occurs when loadouts wants to write to a path that already contains an unmanaged file (one loadout didn't create).

Loadouts **never overwrites** unmanaged files. Instead, it:
1. Skips that output
2. Records it as "shadowed" in the state
3. Reports it in `loadouts status` and `loadouts info`

**To resolve shadowed files:**

```bash
# Option 1: Import the existing file into loadout
loadouts rule import .cursor/rules/existing.mdc

# Option 2: Remove the file manually, then sync
rm .cursor/rules/existing.mdc
loadouts sync

# Option 3: Keep the unmanaged file (it takes precedence)
# Just ignore the warning — loadout won't touch it
```

---

## Token Estimation

`loadouts info` shows token estimates for context cost:

- **Upfront tokens** — Loaded at session start (rules, instructions, skill descriptions)
- **Lazy tokens** — Loaded on-demand when invoked (full skill content)

Estimation uses ~4 characters per token, which is approximate but good enough to compare loadouts and catch bloat.

Skills are special: only the `description` from `SKILL.md` frontmatter is upfront; the full skill content is lazy-loaded when the agent invokes it.

---

## Troubleshooting

### "No .loadouts/ directory found"

Run `loadouts init` to create one, or check you're in the right directory.

### "Loadout not found: <name>"

The loadout doesn't exist. Check available loadouts with `loadouts list`.

### "Cannot infer artifact kind for path"

The file path doesn't match any known kind. Check:
- Rules must be in `rules/` directory
- Skills must be in `skills/` directory
- Custom kinds need a `.loadouts/kinds/*.yaml` definition

### "Include not found"

A file referenced in your loadout's `include` list doesn't exist. Check the path is relative to `.loadouts/`.

### Outputs not updating after edits

Run `loadouts sync` to regenerate outputs from sources.

### Symlinks broken after moving project

Symlinks use absolute paths. Run `loadouts sync` to recreate them.

---

## Removing Loadout

To completely remove loadout from a project:

```bash
# Remove all managed outputs
loadouts clear

# Delete the loadout directory
rm -rf .loadout

# Optionally remove the generated CLAUDE.md wrapper
rm CLAUDE.md
```

For global config:

```bash
loadouts clear -g
rm -rf ~/.config/loadouts
```

---

## Tips

- **Edit sources, not outputs.** Changes to `.loadouts/` are the source of truth. Run `loadouts sync` after editing.

- **Use `--dry-run`** to preview changes before applying them.

- **Check token cost** with `loadouts info` before activating large configurations.

- **Monorepo support** — Put shared config at repo root, package-specific config in each package's `.loadouts/`.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EDITOR` | Editor for `edit` commands (fallback: `VISUAL`, then `vim`) |
| `VISUAL` | Fallback editor if `EDITOR` is unset |
| `PAGER` | Pager for `loadouts docs` (default: `less`) |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (invalid config, missing files, validation failure) |

---

## See Also

- [AgentSkills Specification](https://agentskills.io)
- Project repository: `loadout/`
