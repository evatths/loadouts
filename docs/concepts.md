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
| `agent` | file | Specialized agents and subagents |
| `instruction` | file | Always-on project instructions |
| `prompt` | file | Slash command templates |
| `extension` | directory | Runtime code extensions |
| `theme` | file | UI theme configuration |
| `opencode-command` | file | OpenCode slash command markdown |
| `opencode-config` | file | Whole-file OpenCode runtime configuration |
| `opencode-cli-config` | file | Whole-file OpenCode CLI configuration (global-only) |
| `opencode-plugin` | file | Local OpenCode plugin modules |

## Supported Tools

| Tool | Rules | Skills | Agents | Instructions | Extra Artifacts |
|------|-------|--------|--------|--------------|-----------------|
| Claude Code | `.claude/rules/*.md` | `.claude/skills/` | `.claude/agents/*.md` | `AGENTS.md` | — |
| Cursor | `.cursor/rules/*.mdc` | `.cursor/skills/` | `.cursor/agents/*.md` | `AGENTS.md` | — |
| OpenCode | `.opencode/rules/*.md` | `.opencode/skills/` | `.opencode/agents/*.md` | `AGENTS.md` | `opencode.json(c)`, `~/.config/opencode/cli.json(c)` (global-only), `.opencode/plugins/`, `.opencode/commands/*.md` |
| Codex | — | `.agents/skills/` | `.codex/agents/*.toml` | `AGENTS.md` | — |
| Pi | — | `.pi/skills/` | — | `AGENTS.md` | `.pi/prompts/*.md`, `.pi/extensions/`, `.pi/themes/` |

## Instructions Compose

Instruction files from all active loadouts are concatenated into one generated file per scope (`.loadouts/AGENTS.loadouts-generated.md` for a project, `~/.config/loadouts/AGENTS.loadouts-generated.md` globally). Each section is marked with `<!-- loadouts:begin <loadout> · <path> -->` comments, and `AGENTS.md` (plus the global destinations such as `~/.claude/CLAUDE.md`) is a symlink to that file.

Don't edit `AGENTS.md` or the generated file: edit the source instruction files and run `loadouts sync`. If you do edit it, `sync` and `activate` leave your edits alone, show a diff per section, apply everything else, and exit 1. `--force` saves your edited content to `.loadouts/AGENTS.loadouts-generated.md.bak` and regenerates. See [compatibility.md](compatibility.md) for the per-tool paths.

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
