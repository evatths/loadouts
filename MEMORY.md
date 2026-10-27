# MEMORY

## Instructions compose into one generated file (2026-10-23)

All active loadouts' instruction sources are concatenated into one generated
file per scope, and every instruction destination is a symlink to it: project
`.loadouts/AGENTS.loadouts-generated.md` → `AGENTS.md`; global
`~/.config/loadouts/AGENTS.loadouts-generated.md` → `~/.claude/CLAUDE.md`,
`~/.config/opencode/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.pi/agent/AGENTS.md`.
The file lives in the loadout root next to `.state.json` (`ctx.configPath`).

- **`ManifestEntry.sources` fans in**: a composed destination entry lists every
  source, with `sourcePath` = the generated file. **Attribute entries to
  artifacts with `entrySources`/`expandDriftBySource` (`src/core/manifest.ts`),
  never `entry.sourcePath`.**
- The generated file is not itself a manifest entry; its lifecycle follows the
  composed destination entries (zero sources → no file, stale ones pruned).
- **Held-edit semantics:** if the composed file (or `AGENTS.md` as a regular
  file with different content) was edited, `sync`/`activate` leave it alone,
  show a per-section diff, apply everything else, and exit 1; their rows show `!` (status: `modified`).
  `--force` saves the edit to `.loadouts/AGENTS.loadouts-generated.md.bak` (one
  `.bak`, overwritten each time) and regenerates. Last-instruction deactivate,
  `clear`, and `remove` back up, delete, and warn.
- **Claude global target is `~/.claude/CLAUDE.md`** (Claude has no user-level
  `AGENTS.md`). The old `~/CLAUDE.md` was harmful: Claude treats an ancestor
  `CLAUDE.md` as the project instructions and stops reading `AGENTS.md` in every
  project under `~`. Migration: `loadouts sync -g` once deletes it and the old
  `~/AGENTS.md`. Project Claude relies on native `AGENTS.md` (≥ 2.1.277); no
  `CLAUDE.md` wrapper is generated any more.
- Content is the union for the scope; per-include `tools:` only picks which
  destinations get a symlink. Codex reads only the first 32 KiB, so the composer
  warns above that.
- Not built: write-back of edited sections to sources.

## OpenCode dependency policy: track latest, no back-compat (2026-10-18)

`@opencode/*` and `@opentui/*` use caret ranges, and every `@opencode/*` package
moves to the same version together. The lockfile is what keeps builds
reproducible. We target the newest OpenCode release and use its current APIs
without shims, fallbacks, or support for older versions. Exact pins or a
stated support range are deferred until the user base grows. Don't re-add pins
"for safety." `@opentui/*` stays on the minor version OpenCode itself
depends on (check `npm view @opencode/plugin@<v> devDependencies`), not npm
latest: the TUI host supplies OpenTUI at runtime.

Bump recipe: `npm install` → `npm run lint` (finds every API drift) → `npm run
build` (regenerates the bundled plugin, which inlines `@opencode/*`) → both
`scripts/opencode-session-*e2e.mjs`. Bump `TESTED_OPENCODE_VERSION` in
`src/integrations/opencode/client.ts`; the restart e2e reads it.

2.0.3 → 2.0.32 drift, for pattern-matching the next bump: `permission.rules`
→ `session.update({ permissions })`; `health.get` → `server.info`;
`plugin.awaitActivation` removed; skill `location` → `path` and `slash`
dropped; event `session.permissions.updated` → `session.permissions`;
`session.command({ command })` → `{ name }`; theme tokens `default`/`subdued`
→ `base`/`muted`/`faint`, `background.surface` → `background.raised`.
**`awaitActivation` has no replacement and is still needed.** A freshly booted
location answers `plugin.list` with `[]` and `skill.list` with a partial
catalog for about 1 s. `SessionActivator.activated()` polls `plugin.list` until
it's non-empty. Without that poll, unselected skills escape the deny list.

## Gitignore freshness is part of the render pipeline (2026-09-27)

Gitignore used to be refreshed only by artifact lifecycle commands (add/
delete/import). Now `refreshGitignores()` in `src/core/render.ts` runs at the
end of `applyPlan`, `applyMultiPlan`, and `removeManaged`, so every real
filesystem mutation (CLI activate/sync/deactivate/clear/remove, init
auto-apply, and the TUI's apply path in `src/tui/core/actions.ts`) leaves
per-target `.gitignore`s current — entries appear for new definitions and
stale ones are pruned. Don't re-add per-command `rebuildAllGitignores` calls
after `applyTargetSet`; only sync.ts keeps one, for the nothing-to-render
(earlyExit) path. Best-effort (try/catch): gitignore failures never break a
render. Bundled embedded runtimes must be regenerated (`npm run
build:embedded`) after touching core/render.ts.

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

Implemented 2026-09-15 against OpenCode `2.0.3`; re-verified on `2.0.32`
(2026-10-18). Design/verification record:
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
