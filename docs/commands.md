# Command Reference

## Active Configuration

### `loadouts activate <names...>`
Add loadout(s) to the active set and render outputs.
```bash
loadouts activate backend              # Single loadout
loadouts activate base frontend        # Multiple loadouts
loadouts activate ml -g                # Global scope
loadouts activate backend --dry-run    # Preview only
```

### `loadouts deactivate <names...>`
Remove loadout(s) from the active set.
```bash
loadouts deactivate backend
```

### `loadouts sync`
Re-render active loadouts from latest definitions. Run after editing rules or skills.
```bash
loadouts sync              # All scopes
loadouts sync -l           # Project only
loadouts sync --dry-run    # Preview
```

### `loadouts status`
Show drift status. Detects config drift (definition changed) and output drift (files modified/missing).
```bash
loadouts status
```

### `loadouts clear`
Deactivate all loadouts and remove all outputs.
```bash
loadouts clear             # Project scope
loadouts clear -g          # Global scope
loadouts clear -a          # Both scopes
```

### `loadouts info [name]`
Show loadout details including artifacts, tools, and token estimates.
```bash
loadouts info              # Active loadout(s)
loadouts info backend      # Specific loadout
```

### `loadouts runtime [names...]`
Compile a runtime bundle for inspection (no filesystem activation). Defaults to the root `default` loadout (or `base`).
```bash
loadouts runtime                     # Compile default loadout
loadouts runtime base backend        # Compile multiple loadouts
loadouts runtime base --tool cursor  # Target a different tool
loadouts runtime base --json         # Output RuntimeBundle JSON only
loadouts runtime base --system-block # Output renderRuntimeSystemBlock(bundle) only
```

See `docs/runtime.md` for architecture, OpenCode-first integration flow, and per-tool capability flags.

### `loadouts diff [name]`
Preview what would change if a loadout were applied.
```bash
loadouts diff backend
```

---

## Bundle Management

### `loadouts init`
Initialize a new `.loadouts/` directory. Creates structure, base loadout, and applies it.
```bash
loadouts init              # Project
loadouts init -g           # Global
loadouts init --force      # Overwrite existing
```

### `loadouts install [source]`
Discover and import existing tool configurations. When `source` is provided, import from that file or directory instead of scanning the current tool config directories.
```bash
loadouts install                   # All configs
loadouts install ./agent-pack      # Import from a source directory
loadouts install ./rule.mdc        # Import a single rule file
loadouts install --dry-run         # Preview
loadouts install -i                # Interactive
loadouts install --rules           # Rules only
loadouts install --from cursor     # From specific tool
loadouts install --keep            # Don't delete originals
```

### `loadouts create <name>`
Create a new loadout definition.
```bash
loadouts create backend            # Project loadout
loadouts create ml -g              # Global loadout
loadouts create api --extends base # Extend another loadout
loadouts create test -d "Testing"  # With description
```

### `loadouts add-to <loadout> <artifacts...>`
Add existing artifacts to a loadout include list.
```bash
loadouts add-to backend rules/api.md
loadouts add-to backend skills/debugger
loadouts add-to backend rules/cursor.md --tools cursor
```

### `loadouts remove-from <loadout> <artifacts...>`
Remove artifacts from a loadout include list without deleting the artifact files.
```bash
loadouts remove-from backend rules/api.md
loadouts remove-from backend skills/debugger
```

### `loadouts edit <name>`
Open a loadout definition in `$EDITOR`.
```bash
loadouts edit backend
```

### `loadouts remove [name]`
Remove applied loadout outputs.
```bash
loadouts remove            # All outputs
loadouts remove backend    # Validate name first
loadouts remove --dry-run  # Preview
```

### `loadouts list`
List available loadouts with item count, description, and inheritance.
```bash
loadouts list              # All scopes
loadouts list -l           # Project only
loadouts list -g           # Global only
```

### `loadouts check`
Validate configuration (YAML syntax, file references, circular extends, tool prerequisites).
```bash
loadouts check
loadouts check -v          # Verbose
```

---

## Artifact Authoring

### Rules

Create scoped advisory files that tools inject based on file context.

```bash
loadouts rule add my-rule                 # Create rule
loadouts rule add go -p "**/*.go"         # With path pattern
loadouts rule add strict --always-apply   # Always apply
loadouts rule list                        # List rules
loadouts rule edit my-rule                # Edit rule
loadouts rule remove my-rule              # Remove rule
loadouts rule import ./existing.md        # Import file
```

After creating a rule, add it to your loadout's `include` list and run `loadouts sync`.

### Skills

Create on-demand capabilities with instructions and supporting files.

```bash
loadouts skill add deploy                 # Create skill
loadouts skill add debug -g               # Global skill
loadouts skill list                       # List skills
loadouts skill edit deploy                # Edit skill
loadouts skill remove deploy              # Remove skill
loadouts skill import ./my-skill          # Import directory
```

After creating a skill, add it to your loadout's `include` list and run `loadouts sync`.

### Instructions

Create per-loadout instruction files that render to `AGENTS.md` or `CLAUDE.md`.

```bash
loadouts instructions init                # Create for active loadout
loadouts instructions init backend        # For specific loadout
loadouts instructions edit                # Edit instructions
loadouts instructions list                # List instruction files
loadouts instructions import              # Import existing AGENTS.md
loadouts instructions import --loadout backend  # Import to specific loadout
```

### Kinds
```bash
loadouts kinds             # List registered kinds
loadouts kinds -v          # With detection rules
```

---

## Scope Flags

Most state commands (`activate`, `deactivate`, `sync`, `status`, `clear`, `list`, `info`, `check`) support scope flags:

| Flag | Description |
|------|-------------|
| `-l, --local` | Project scope only |
| `-g, --global` | Global scope only |
| `-a, --all` | Both scopes |

`runtime` supports `-l/--local` and `-g/--global` only (no `--all`).

When omitted, commands auto-detect scope based on context. Use `--dry-run` to preview behavior before destructive operations.

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EDITOR` | Editor for edit commands |
| `VISUAL` | Fallback editor |
| `PAGER` | Pager for docs (default: `less`) |
