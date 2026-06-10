# Core Concepts

## The `.loadouts/` Directory

Project configuration lives in `.loadouts/` (global config lives in `~/.config/loadouts/`):

```
.loadouts/
├── loadouts.yaml         # Root config (version, defaults)
├── loadouts/             # Named configuration bundles
│   └── base.yaml
├── instructions/         # Per-loadout instruction files
│   └── AGENTS.base.md
├── rules/                # Portable rule files
└── skills/               # Portable skill directories
```

## Scopes

| Scope | Location | Flag | Purpose |
|-------|----------|------|---------|
| **Project** | `./.loadouts/` | `-l` | Project-specific config |
| **Global** | `~/.config/loadouts/` | `-g` | User-wide config |

Most commands auto-detect scope. Use `-l`/`-g` to be explicit, or `-a` for both.

## Active State

**Activating** a loadout adds it to the "active set" and renders its artifacts to tool directories. The active set persists in `.loadouts/.state.json` — you don't need to re-activate after restarting your terminal.

- `loadouts activate <name>` — Add to active set and render
- `loadouts deactivate <name>` — Remove from active set and clean up outputs
- `loadouts sync` — Re-render active loadouts (after editing source files)
- `loadouts status` — Show what's active and detect drift

## Loadouts

A **loadout** is a named bundle of artifacts:

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

**Inheritance:** `extends: base` pulls in the parent's artifacts. Child items take precedence.

**Multiple active:** Activate several loadouts together:

```bash
loadouts activate base backend ml    # All three active
```

When multiple loadouts define the same artifact, later arguments take precedence (`ml` wins over `backend` wins over `base`).

**Per-artifact tool targeting:**

```yaml
include:
  - rules/general.md                      # All tools
  - path: rules/cursor-only.md
    tools: [cursor]                       # Cursor only
```

## Artifact Kinds

| Kind | Layout | Description |
|------|--------|-------------|
| `rule` | file | Scoped advisory rules (`.md`) |
| `skill` | directory | On-demand capabilities with `SKILL.md` |
| `instruction` | file | Always-on project instructions |
| `prompt` | file | Slash command templates |
| `extension` | directory | Runtime code extensions |
| `theme` | file | UI theme configuration |
| `opencode-command` | file | OpenCode slash command markdown |
| `opencode-config` | file | Whole-file OpenCode runtime configuration |
| `opencode-plugin` | file | Local OpenCode plugin modules |

## Supported Tools

| Tool | Rules | Skills | Instructions | Extra Artifacts |
|------|-------|--------|--------------|-----------------|
| Claude Code | `.claude/rules/*.md` | `.claude/skills/` | `CLAUDE.md` | — |
| Cursor | `.cursor/rules/*.mdc` | `.cursor/skills/` | `AGENTS.md` | — |
| OpenCode | `.opencode/rules/*.md` | `.opencode/skills/` | `AGENTS.md` | `opencode.json(c)`, `.opencode/plugins/`, `.opencode/commands/*.md` |
| Codex | — | `.agents/skills/` | `AGENTS.md` | — |
| Pi | `.pi/rules/*.md` | `.pi/skills/` | `AGENTS.md` | `.pi/extensions/`, `.pi/themes/` |

## Sources (Cross-Project Config)

Share configuration across projects:

```yaml
# packages/api/.loadouts/loadouts.yaml
version: "1"
sources:
  - ../..                    # Parent monorepo
  - ~/dotfiles               # Personal global config
```

**Resolution order:** Local `.loadouts/` → Sources (in declaration order) → Global `~/.config/loadouts/`.

When two sources define a loadout with the same name, the first match wins. If a source path doesn't exist, loadouts warns and continues.

## Output Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `symlink` | Target symlinks to source | Default; edits stay in sync |
| `copy` | Target is a managed copy | Tools that don't follow symlinks |
| `generate` | Target is rendered/wrapped | Tool-specific transformations |
