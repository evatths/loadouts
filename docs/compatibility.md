# Compatibility

Current built-in rendering targets for canonical artifacts.

## Artifact Paths (Project Scope)

| Tool | Rule | Skill | Agent | Instruction | Extra Artifacts |
|------|------|-------|-------|-------------|-----------------|
| Claude Code | `.claude/rules/<name>.md` | `.claude/skills/<name>/` | `.claude/agents/<name>.md` | `AGENTS.md` | - |
| Cursor | `.cursor/rules/<name>.mdc` | `.cursor/skills/<name>/` | `.cursor/agents/<name>.md` | `AGENTS.md` | - |
| OpenCode | `.opencode/rules/<name>.md` | `.opencode/skills/<name>/` | `.opencode/agents/<name>.md` | `AGENTS.md` | `.opencode/commands/<name>.md`, `.opencode/plugins/<name>.{ts,tsx,js}`, `~/.config/opencode/cli.json(c)` (global-only), `opencode.json(c)` |
| Codex | - (no rule target) | `.agents/skills/<name>/` | `.codex/agents/<name>.toml` | `AGENTS.md` | - |
| Pi | - (no native rule target) | `.pi/skills/<name>/` | - | `AGENTS.md` | - |

## Instruction Paths (Global Scope)

| Tool | Instruction |
|------|-------------|
| Claude Code | `~/.claude/CLAUDE.md` (Claude has no user-level `AGENTS.md`) |
| Cursor | none (User Rules are set in the Cursor UI, not in a file) |
| OpenCode | `~/.config/opencode/AGENTS.md` |
| Codex | `~/.codex/AGENTS.md` (`CODEX_HOME` is not honoured) |
| Pi | `~/.pi/agent/AGENTS.md` |

Other artifact kinds use each tool's configured global base path.

### Composed instructions

The instruction files of all active loadouts are concatenated into one generated file per scope, and every instruction destination above is a symlink to it:

- Project: `.loadouts/AGENTS.loadouts-generated.md`, linked from `AGENTS.md`.
- Global: `~/.config/loadouts/AGENTS.loadouts-generated.md`, linked from the global destinations above.

Sources appear in loadout activation order, then include order within each loadout. A source file shared by several loadouts is included once. A per-include `tools:` list on an instruction only chooses which destinations get a symlink; the file contents are the same for every tool in that scope.

Claude Code (v2.1.277 or newer) reads project `AGENTS.md` natively, but only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working directory or any directory above it. Older Claude Code versions are not supported for project instructions. Codex reads only the first 32 KiB of the file (`project_doc_max_bytes`); loadouts warns when the composed file is larger and Codex is a destination.

## Canonical Frontmatter

- Canonical rule fields: `description`, `paths`, `activation` (`always` or `scoped`).
- Canonical skill fields: `name`, `description`, `user-invocable`, `model-invocable`.
- Canonical agent files are Markdown under `.loadouts/agents/<name>.md`; use top-level portable fields plus `targets.<tool>` overlays for harness-specific config.

Rendered aliases for compatibility:

- Cursor/OpenCode rules: `paths` is mirrored to `globs`.
- Cursor/OpenCode rules: `activation` is mirrored to `alwaysApply` (`always -> true`, `scoped -> false`).
- OpenCode skills: `model-invocable` is mirrored to `metadata["opencode/autoinvoke"]` (same boolean, not inverted — OpenCode V2 has no `disable-model-invocation` field).
- Agent overlays are rendered into each harness' native frontmatter. Codex agents are generated as TOML with the Markdown body mapped to `developer_instructions`.

Transforms add aliases when canonical fields are present and alias fields are not already set.

Agent Markdown targets use symlinks only when the source frontmatter is already native-safe for that harness. Files with `targets:` overlays are rendered as managed copies so tool-specific fields do not leak into other harnesses.

Agent import and migration canonicalize native harness definitions. Compatible fields are inferred when possible: read-only native settings become canonical `readonly: true`, Cursor/Claude background settings become canonical `background`, OpenCode/Codex/Claude reasoning effort settings are mirrored across compatible target overlays, and OpenCode `steps` / Claude `maxTurns` are mirrored between those harnesses.

## Known Limitations

- Codex and Pi do not currently have a built-in rule output target.
- Pi does not currently have a built-in agent output target.
- Frontmatter aliasing is only applied on transformed targets.
- If both canonical and alias fields are set by hand, existing alias values are preserved.
