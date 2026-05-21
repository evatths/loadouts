# Loadouts

**Composable configuration bundles for AI coding agents.**

Loadouts organizes your rules, skills, and instructions into named **loadouts** that you can mix and match:

- **Task-specific configs** — Activate `backend` for API work, `frontend` for UI work, or both
- **Team flexibility** — Track all configs in one place; teammates activate what they need
- **Tool portability** — Write once, apply to Claude Code, Cursor, OpenCode, Codex, and Pi

```bash
loadouts activate base backend     # Backend task
loadouts activate base frontend    # Switch to frontend
loadouts activate base backend ml  # Combine multiple
```

## Getting Started

```bash
npm install -g loadouts     # Requires Node.js 18+
loadouts docs quickstart           # Step-by-step setup guide
```

## Quick Reference

```bash
# Setup
loadouts init                      # Initialize .loadouts/
loadouts install                   # Import existing configs
loadouts install ./agent-pack      # Import from a source directory

# Daily use
loadouts activate <name>           # Activate loadout(s)
loadouts deactivate <name>         # Deactivate loadout(s)
loadouts sync                      # Re-render after edits
loadouts status                    # Check for drift (source/output changes)

# Authoring
loadouts rule add <name>           # Create a rule
loadouts skill add <name>          # Create a skill
loadouts instructions init         # Create instructions
loadouts create <name>             # Create a loadout

# Info
loadouts list                      # List available loadouts
loadouts info [name]               # Show loadout details
loadouts check                     # Validate configuration
```

## Documentation Topics

```bash
loadouts docs quickstart       # Get started in 60 seconds
loadouts docs concepts         # Loadouts, artifacts, scopes, tools
loadouts docs commands         # Full command reference
loadouts docs authoring        # Creating rules, skills, instructions
loadouts docs compatibility    # Tool paths, frontmatter aliases, limits
loadouts docs workflows        # Team setup, git, CI/CD
loadouts docs troubleshooting  # Common issues and solutions
```

Use `loadouts docs <topic>` to read any section, or `loadouts docs --list` for descriptions.
