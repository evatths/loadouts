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

**OpenCode V2:** Rules render to `.opencode/rules/`, commands to `.opencode/commands/`, local plugins to `.opencode/plugins/`, and NPM plugins are configured with the `plugins` array in `opencode.json(c)`. Global instructions render to `~/.config/opencode/AGENTS.md`. OpenCode hot-reloads these sources.

### `/loadouts` not working in OpenCode runtime

1. Verify `plugins/loadouts/{package.json,index.js,tui.js}` exists under the
   project's `.opencode/` or global `~/.config/opencode/` directory.
2. Check `loadouts info -l` or `loadouts info -g` for `opencode-runtime` and
   `loadouts status` for shadowed/missing output. A source checkout needs
   `npm run build` before activation.
3. Open OpenCode's Plugins dialog and inspect the server/TUI entries. Local
   plugin directories do not install server dependencies; use the built,
   self-contained artifact rather than copying `src/tui/hosts/opencode/`.
4. Test the independent HTTP path with
   `loadouts session status --session ses_...`.
5. `/loadouts` and `ctrl+l` are client-side commands. The server entry is needed
   for clean per-session skill advertisements; native permission denies alone
   still leave skills listed on OpenCode 2.0.3.

If permissions were edited after equip, unequip preserves those edits and reports
it. See [runtime ownership and recovery](opencode-v2-runtime.md#persistence-and-ownership).

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

### AGENTS.md has local edits / `sync` exits 1

`AGENTS.md` is a symlink to the generated file `.loadouts/AGENTS.loadouts-generated.md`, which loadouts rebuilds from your instruction sources. If that file was edited (or `AGENTS.md` was replaced by a regular file with different content), `sync` and `activate` do not overwrite it. They show a diff for each section ("from <loadout> (<source path>)"), apply everything else, and exit 1. The `sync`/`activate` table marks the held instruction rows `!`, and `loadouts status` reports them as `modified`.

**To resolve:**
- Move the edits into the source instruction file (`.loadouts/instructions/AGENTS.<loadout>.md`), then run `loadouts sync` again. Note that Claude Code's Edit/Write tools refuse to write through symlinks, so edit the source, not `AGENTS.md`.
- Or discard the edits: `loadouts sync --force` (or `activate --force`). Your edited content is saved to `.loadouts/AGENTS.loadouts-generated.md.bak` first; only one backup is kept, and each run overwrites it.

Deactivating the last instruction, `loadouts clear`, and `loadouts remove` also back up an edited file, delete it, and warn.

### Claude Code ignores AGENTS.md

Claude Code reads project `AGENTS.md` natively (in its default `claude-md-or-agents-md` mode) only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working directory or in any directory above it. Loadouts warns when it finds one at project scope. Check:

- **A `CLAUDE.md` in an ancestor directory.** The most common culprit is a leftover `~/CLAUDE.md` from older loadouts versions, which silently disables `AGENTS.md` for every project under your home directory. It is safe to delete if its text says "auto-generated by Loadouts"; running `loadouts sync -g` once removes it (and the old `~/AGENTS.md`). Global instructions now go to `~/.claude/CLAUDE.md`.
- **Claude Code older than v2.1.277.** Older versions don't read `AGENTS.md`, and loadouts doesn't support them for project instructions. Upgrade Claude Code.
- **The `claudeMdMode` setting.** If it is set to anything other than the default `claude-md-or-agents-md`, Claude may not fall back to `AGENTS.md`. Reset it in your Claude Code settings.

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
```

If `loadouts clear` was skipped, `AGENTS.md` may be left as a dangling symlink; delete it.

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
