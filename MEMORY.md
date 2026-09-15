# MEMORY

## OpenCode V2 naming reconciliation (2026-09-15)

Fixed three pre-V2-runtime naming drifts against OpenCode 2.0.3
(`/v2/docs/{agents,permissions,skills,cli/config}`):

- **OpenCode skill invocability is `metadata["opencode/autoinvoke"]`**, a
  nested boolean (not inverted). `disable-model-invocation` was never a real
  V2 field. Render transform `opencode-skill-frontmatter` now mirrors
  `model-invocable` into `metadata`; the canonical sanitizer still *accepts*
  the old alias on import (kept for user-authored files, harmless).
- **`opencode-tui-config` kind is now `opencode-cli-config`**: V2 renamed the
  file to `cli.json(c)` and it is **global-only** (no project-local CLI
  config). `OutputMapping.scopes?: Scope[]` (new, optional) makes a mapping
  scope-restricted; `resolveOutputSpec`, gitignore computation, and import
  discovery all skip out-of-scope mappings. Project-scope renders of this kind
  silently vanish — that's correct, not a bug.
- **OpenCode agent frontmatter now emits V2-native shapes**: `disabled` (not
  `disable`), `permissions` array of `{action, resource, effect}` (not the
  `permission` map; canonical `readonly: true` appends an `edit: deny` rule,
  which wins under V2 last-match-wins), and `variant`/`reasoningEffort`
  folded into `model: provider/model#variant`. `temperature`/`top_p` are
  dropped (V1 fields, documented no-ops in V2).

## OpenCode V2 runtime (session-scoped loadout switching)

Implemented 2026-09-15 against OpenCode `2.0.3`. Design/verification record:
`plans/OPENCODE-V2-RUNTIME.md`, `docs/opencode-v2-runtime.md`,
`docs/opencode-v2-probes.md`. Usage: `docs/runtime.md`.

Three equip layers: **global**/**project** (existing filesystem render engine,
native OpenCode hot reload) and **session** (`SessionActivator` in
`src/integrations/opencode/session.ts`, over `@opencode/client`, zero server
plugin required — one instruction entry per loadout + session permission rules).

Load-bearing facts, easy to relitigate by accident:

- **Session `skill` permission deny blocks the tool but does not hide the
  skill from `<available_skills>`.** Verified live on 2.0.3. This is why the
  server plugin (`src/tui/hosts/opencode/index.ts`) filters the advertisement
  itself in a `session.hook("context")` — a "phase 3 nice-to-have" in the
  original plan turned out to be required for clean per-session skill sets.
- **Instruction entries are 256 KiB per entry** (`Buffer.byteLength(JSON.stringify(value), "utf8")`),
  persisted server-side, rendered after `AGENTS.md`, and OpenCode announces
  changes to the model itself ("context under X changed and supersedes…") —
  do not add our own acknowledgment text.
- **No API transaction or compare-and-swap exists in V2.** `SessionActivator`
  serializes per-session ops in-process and rolls back on partial HTTP
  failure, but a crash mid-equip or a second concurrent client can still
  interleave. Inspect entries/rules manually before recovering such a session.
- **Never route generated instructions through `opencode.json`'s
  `instructions` array** — accepted but unresolved in V2. Render to
  `AGENTS.md` only (already how `opencode-tool.ts` renders global/project).
- **Local OpenCode plugin *server* directories do not install dependencies.**
  The server bundle (`bundled/opencode/plugins/loadouts/index.js`) must be
  self-contained; only the *TUI* half gets host-injected `@opencode/plugin/tui`,
  `@opentui/solid`, `solid-js` aliases (Bun-only injection — no equivalent on
  the Node CLI, hence pi-tui stays the standalone/Pi renderer, not opentui).
- Reproducers, safe to run against a real service without disturbing it:
  `scripts/opencode-session-e2e.mjs` (`--prompts` adds real model turns) and
  `scripts/opencode-session-restart-e2e.mjs` (spins its own isolated
  XDG-rooted service; never touches the shared one).

## Standalone TUI Node floor

`loadouts tui` requires Node 22.19+ (pi-tui). The rest of the CLI supports
Node 18+. OpenTUI (the embedded OpenCode/Pi renderer) needs Bun or Node 26.4+
with `--experimental-ffi` — not viable as the standalone renderer under an
`engines: >=18` npm package. Revisit only if the Node floor moves or the
audience shifts to "people who want the OpenCode UI outside OpenCode."
