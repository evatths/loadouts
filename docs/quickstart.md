# Quickstart

Get loadouts running in under a minute.

## Installation

```bash
npm install -g loadouts
```

Requires Node.js 18+.

## Getting Started

The fastest way to start is `loadouts init`, which detects and imports any existing agent configs:

```bash
loadouts init
```

This creates `.loadouts/`, scans for existing rules/skills in `.claude/`, `.cursor/`, `.opencode/`, etc., and offers to import them. If you have scattered configs, this is the recommended entry point.

**To import explicitly** (or re-import later):

```bash
loadouts install                   # Discover and import existing configs
loadouts install ./agent-pack      # Import from a source directory
loadouts install ./rule.mdc        # Import a single artifact
loadouts install --dry-run         # Preview what would be imported
loadouts install -i                # Interactive mode (select what to import)
```

## New Project (no existing configs)

If you're starting fresh with no existing agent configs:

```bash
loadouts init                      # Creates .loadouts/ with a base loadout
loadouts rule add coding-standards # Create a rule file
loadouts add-to base rules/coding-standards.md
loadouts sync                      # Render to tool directories
```

Your rule now appears in `.claude/rules/`, `.cursor/rules/`, and other configured tools.

**Verify it worked:**
```bash
loadouts status                    # Should show "ok" with no drift
```

## Existing Project (with scattered configs)

Already have rules in `.cursor/rules/` or `.claude/rules/`? The recommended flow:

```bash
loadouts init                      # Detects configs and offers to import
```

If you skipped import during init, or want to import additional configs later:

```bash
loadouts install                   # Import existing configs
loadouts install ./agent-pack      # Import from a source directory
loadouts sync                      # Render unified config
```

Without a path, this finds rules/skills across `.claude/`, `.cursor/`, `.opencode/`, etc. and consolidates them into `.loadouts/`. With a path, it imports from that specific file or directory.

**Verify it worked:**
```bash
loadouts list                      # Shows your loadouts
loadouts status                    # Shows rendered artifacts
```

## Task-Specific Loadouts

Create separate loadouts for different work contexts:

```bash
loadouts create backend -e base    # New loadout extending base
loadouts rule add api-standards    # Create a rule
loadouts edit backend              # Add rules/api-standards.md to include list
loadouts activate backend          # Apply it
```

Switch contexts by activating different loadouts:

```bash
loadouts activate base frontend    # Frontend work
loadouts activate base backend ml  # Backend + ML combined
```

## How It Works

1. **Source files** live in `.loadouts/` (rules, skills, loadout definitions)
2. **Loadouts** bundle artifacts together (`loadouts/base.yaml`)
3. **Activating** a loadout renders its artifacts to each tool's expected location
4. **Syncing** re-renders after you edit source files

## What's Next

- `loadouts docs concepts` — Understand loadouts, scopes, and tools
- `loadouts docs authoring` — Create rules, skills, instructions
- `loadouts docs workflows` — Team onboarding, git hooks, CI setup
