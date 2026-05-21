# Loadouts

**Composable configuration bundles for AI coding agents.**

Organize your rules, skills, and instructions into named **loadouts** that you can mix and match based on the task at hand.

```bash
loadouts activate base backend     # Backend work
loadouts activate base frontend    # Frontend work  
loadouts activate base backend ml  # Combine for ML backend work
```

## Why Loadout?

**Not every task needs the same configuration.** Backend work needs different rules than frontend work. ML projects need specialized skills. Code review needs different context than greenfield development.

**Not every teammate wants the same setup.** One person might want strict linting rules, another prefers minimal guidance. Loadouts lets teams track all available configurations while giving individuals the freedom to activate what works for them.

**Not every tool uses the same format.** Claude Code, Cursor, OpenCode, Codex, and Pi each have their own config locations and quirks. Loadouts lets you write once and renders correctly for each tool.

## Installation

### npm (recommended)

```bash
npm install -g loadouts
```

### From source

```bash
git clone https://github.com/evatths/loadouts.git
cd loadouts
npm install
npm run build
npm link
```

## Quick Start

```bash
# Initialize
loadouts init

# Create task-specific loadouts
loadouts create backend -e base    # Extends base
loadouts create frontend -e base
loadouts create ml -e base

# Add rules/skills to each
loadouts rule add api-standards    # Add to current loadout
loadouts skill add debugging

# Activate what you need
loadouts activate backend          # Just backend
loadouts activate backend ml       # Backend + ML combined
```

## Importing Existing Configs

Already have rules and skills scattered across tool directories?

```bash
loadouts init                      # Detects existing configs automatically
loadouts install                   # Or import them separately
loadouts install ./agent-pack      # Import from a source directory
loadouts install ./rule.mdc        # Import a single artifact
loadouts sync
```

`loadouts install` scans all tool directories (`.claude/`, `.cursor/`, `.opencode/`, etc.) and imports everything it finds. Pass a file or directory to import from a specific source. Use `--dry-run` to preview, `-i` for interactive selection, and `--keep` to leave originals in place.

## Documentation

Loadout is self-documenting:

```bash
loadouts docs              # Overview and quick reference
loadouts docs quickstart   # Get started in 60 seconds
loadouts docs concepts     # Core model explained
loadouts docs commands     # Full command reference
loadouts docs --list       # List all topics
```

Or read the full reference: [LOADOUT.md](LOADOUT.md)

### For AI Agents

Loadout includes a bundled skill that teaches AI agents how to use it:

```bash
loadouts skill import --builtin loadouts-usage
loadouts sync
```

This adds a skill that triggers when agents are editing agent configuration (rules, skills, instructions), guiding them to use the CLI and `loadouts docs` for details.

## Supported Tools

| Tool | Rules | Skills | Instructions | Extra Artifacts |
|------|-------|--------|--------------|-----------------|
| Claude Code | ✓ | ✓ | ✓ | — |
| Cursor | ✓ | ✓ | ✓ | — |
| OpenCode | ✓ | ✓ | ✓ | config, plugins |
| Codex | — | ✓ | ✓ | — |
| Pi | ✓ | ✓ | ✓ | extensions, themes |

## License

Apache-2.0
