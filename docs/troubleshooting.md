# Troubleshooting

## Common Issues

### "No .loadouts/ directory found"

Run `loadouts init` to create one, or check you're in the right directory.

### "Loadout not found: <name>"

The loadout doesn't exist in the current scope. Check available loadouts:
```bash
loadouts list        # Project scope
loadouts list -g     # Global scope
loadouts list -a     # Both scopes
```

### "Cannot infer artifact kind for path"

The file path doesn't match any known kind. Built-in kinds expect:
- **Rules:** `rules/*.md`
- **Skills:** `skills/<name>/SKILL.md`
- **Instructions:** `instructions/AGENTS.*.md`
- **Prompts:** `prompts/*.md`

For custom artifact types, create a `.loadouts/kinds/*.yaml` definition. Run `loadouts kinds -v` to see all registered kinds and their detection rules.

### "Include not found"

A file in your loadout's `include` list doesn't exist. Paths are relative to `.loadouts/`.

### Outputs not updating after edits

Run `loadouts sync` to regenerate outputs from sources. Then verify with `loadouts status`.

If outputs still don't appear, check:
1. Is the artifact included in an active loadout? (`loadouts info`)
2. Is the loadout activated? (`loadouts status`)

### Symlinks broken after moving project

Symlinks use absolute paths. Run `loadouts sync` to recreate them.

### Tool not picking up rules/skills

First, verify outputs were rendered:
```bash
loadouts status    # Check for drift or missing outputs
loadouts sync      # Re-render if needed
```

**Cursor:** Rules need `.mdc` extension — loadouts handles this automatically. Restart Cursor if rules don't appear immediately.

**OpenCode:** Rules render to `.opencode/rules/`, commands to `.opencode/commands/`, local plugins to `.opencode/plugins/`, and NPM plugins are configured with the `plugin` array in `opencode.json(c)`.

### `/loadouts` not working in OpenCode runtime

If `/loadouts` exists but does not activate runtime behavior, verify the full chain:

1. Runtime artifacts are rendered in the expected scope:
   - Local: `.opencode/plugins/loadouts-runtime.ts` and `.opencode/commands/loadouts.md`
   - Global: `~/.config/opencode/plugins/loadouts-runtime.ts` and `~/.config/opencode/commands/loadouts.md`
2. Runtime scaffold is active in the same scope (`loadouts info -l` or `loadouts info -g`).
3. Restart OpenCode after activation or plugin/command changes (startup-time plugin loading).
4. Check the `loadouts` binary on OpenCode's `PATH` supports runtime:
```bash
loadouts runtime base --tool opencode --json
```
5. If command acknowledgment text looks model-generated, treat it as expected host behavior; the deterministic part is plugin state update and runtime system injection.

**Claude Code:** Verify rules exist in `.claude/rules/`. May require restarting the session.

**Codex:** Rules not yet supported; skills and instructions only.

---

## Validation

Run validation to catch issues:
```bash
loadouts check -v
```

Validates:
- YAML syntax
- All referenced files exist
- No circular `extends`
- Tool prerequisites satisfied
- No unmanaged file collisions (shadowed files)

### Shadowed file collision

A **shadowed file** occurs when loadouts wants to write to a path that already has an unmanaged file. Loadouts never overwrites unmanaged files — it skips them and reports the collision.

**To resolve:**
```bash
loadouts rule import .cursor/rules/existing.mdc  # Import into loadout
# OR
rm .cursor/rules/existing.mdc && loadouts sync  # Remove and re-render
# OR keep the unmanaged file (it takes precedence)
```

---

## Debugging

### Preview changes without applying
```bash
loadouts activate backend --dry-run
loadouts sync --dry-run
```

### See what's active
```bash
loadouts status
loadouts info
```

### Check token cost
```bash
loadouts info backend    # Shows upfront and lazy tokens
```

---

## Removing Loadouts

### From a project

**Warning:** These commands delete your loadout configuration. Back up `.loadouts/` first if you want to preserve your rules and skills.

```bash
loadouts clear           # Remove all managed outputs (safe, reversible)
```

To fully remove loadouts from a project:
```bash
loadouts clear           # Remove managed outputs first
rm -rf .loadouts        # Delete source config (irreversible)
rm CLAUDE.md            # Remove generated wrapper if present
```

### Global config

```bash
loadouts clear -g        # Remove global managed outputs
rm -rf ~/.config/loadouts  # Delete global config (irreversible)
```

---

## Getting Help

```bash
loadouts --help          # Command overview
loadouts <cmd> --help    # Command-specific help
loadouts docs            # Full documentation
loadouts docs <topic>    # Topic-specific docs
```
