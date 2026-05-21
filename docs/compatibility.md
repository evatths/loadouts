# Compatibility

Current built-in rendering targets for canonical artifacts.

## Artifact Paths (Project Scope)

| Tool | Rule | Skill | Instruction |
|------|------|-------|-------------|
| Claude Code | `.claude/rules/<name>.md` | `.claude/skills/<name>/` | `CLAUDE.md` (generated wrapper to `AGENTS.md`) |
| Cursor | `.cursor/rules/<name>.mdc` | `.cursor/skills/<name>/` | `AGENTS.md` |
| OpenCode | `.opencode/rules/<name>.md` | `.opencode/skills/<name>/` | `AGENTS.md` |
| Codex | - (no rule target) | `.agents/skills/<name>/` | `AGENTS.md` |
| Pi | - (no native rule target) | `.pi/skills/<name>/` | `AGENTS.md` |

Global scope uses each tool's configured global base path. Instruction files may render to home-level `AGENTS.md` or `CLAUDE.md` paths depending on the tool.

## Canonical Frontmatter

- Canonical rule fields: `description`, `paths`, `activation` (`always` or `scoped`).
- Canonical skill fields: `name`, `description`, `user-invocable`, `model-invocable`.

Rendered aliases for compatibility:

- Cursor/OpenCode rules: `paths` is mirrored to `globs`.
- Cursor/OpenCode rules: `activation` is mirrored to `alwaysApply` (`always -> true`, `scoped -> false`).
- OpenCode skills: `model-invocable` is mirrored to `disable-model-invocation` (inverted boolean).

Transforms add aliases when canonical fields are present and alias fields are not already set.

## Known Limitations

- Codex and Pi do not currently have a built-in rule output target.
- Frontmatter aliasing is only applied on transformed targets (currently Cursor/OpenCode rules and OpenCode skills).
- If both canonical and alias fields are set by hand, existing alias values are preserved.
