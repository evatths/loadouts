# Compatibility

Current built-in rendering targets for canonical artifacts.

## Artifact Paths (Project Scope)

| Tool | Rule | Skill | Agent | Instruction | Extra Artifacts |
|------|------|-------|-------|-------------|-----------------|
| Claude Code | `.claude/rules/<name>.md` | `.claude/skills/<name>/` | `.claude/agents/<name>.md` | `CLAUDE.md` (generated wrapper to `AGENTS.md`) | - |
| Cursor | `.cursor/rules/<name>.mdc` | `.cursor/skills/<name>/` | `.cursor/agents/<name>.md` | `AGENTS.md` | - |
| OpenCode | `.opencode/rules/<name>.md` | `.opencode/skills/<name>/` | `.opencode/agents/<name>.md` | `AGENTS.md` | `.opencode/commands/<name>.md`, `.opencode/plugins/<name>.{ts,tsx,js}`, `.opencode/tui.json(c)`, `opencode.json(c)` |
| Codex | - (no rule target) | `.agents/skills/<name>/` | `.codex/agents/<name>.toml` | `AGENTS.md` | - |
| Pi | - (no native rule target) | `.pi/skills/<name>/` | - | `AGENTS.md` | - |

Global scope uses each tool's configured global base path. Instruction files may render to home-level `AGENTS.md` or `CLAUDE.md` paths depending on the tool.

## Canonical Frontmatter

- Canonical rule fields: `description`, `paths`, `activation` (`always` or `scoped`).
- Canonical skill fields: `name`, `description`, `user-invocable`, `model-invocable`.
- Canonical agent files are Markdown under `.loadouts/agents/<name>.md`; use top-level portable fields plus `targets.<tool>` overlays for harness-specific config.

Rendered aliases for compatibility:

- Cursor/OpenCode rules: `paths` is mirrored to `globs`.
- Cursor/OpenCode rules: `activation` is mirrored to `alwaysApply` (`always -> true`, `scoped -> false`).
- OpenCode skills: `model-invocable` is mirrored to `disable-model-invocation` (inverted boolean).
- Agent overlays are rendered into each harness' native frontmatter. Codex agents are generated as TOML with the Markdown body mapped to `developer_instructions`.

Transforms add aliases when canonical fields are present and alias fields are not already set.

Agent Markdown targets use symlinks only when the source frontmatter is already native-safe for that harness. Files with `targets:` overlays are rendered as managed copies so tool-specific fields do not leak into other harnesses.

Agent import and migration canonicalize native harness definitions. Compatible fields are inferred when possible: read-only native settings become canonical `readonly: true`, Cursor/Claude background settings become canonical `background`, OpenCode/Codex/Claude reasoning effort settings are mirrored across compatible target overlays, and OpenCode `steps` / Claude `maxTurns` are mirrored between those harnesses.

## Known Limitations

- Codex and Pi do not currently have a built-in rule output target.
- Pi does not currently have a built-in agent output target.
- Frontmatter aliasing is only applied on transformed targets.
- If both canonical and alias fields are set by hand, existing alias values are preserved.
