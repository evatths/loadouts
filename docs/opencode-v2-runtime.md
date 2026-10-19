# OpenCode V2 Runtime

Implemented against **OpenCode 2.0.3** (verified 2026-09-14); bumped to and
re-verified against **2.0.32** (`@opencode/*@2.0.32`, OpenTUI 0.5.17) on
2026-10-18. See [runtime.md](runtime.md) for usage and
[the implementation plan](../plans/OPENCODE-V2-RUNTIME.md) for the original scope.
The [beta investigation](archive/opencode-v2-runtime-beta-18707.md) is archived.

## Three equip layers

| Layer | Storage | Applies to |
|---|---|---|
| Global | `~/.config/loadouts/.state.json` and rendered tool files | Every location |
| Project | `.loadouts/.state.json` and rendered tool files | Sessions in the project |
| Session | OpenCode instruction entries and session permission rules | One session ID |

Global/project outputs use OpenCode's native hot reload. Session equips do not
write tool configuration or the filesystem activation manifests.

## Implementation

- `src/integrations/opencode/session.ts`: `SessionActivator`, persisted manifest,
  entry size preflight, permission ownership, in-process serialization, rollback.
- `src/integrations/opencode/delta.ts`: resolver-backed compilation minus intact
  managed OpenCode outputs. Full skill selection survives delta exclusion.
- `src/integrations/opencode/client.ts`: authenticated service discovery; never
  starts a service during normal use. Reports version mismatches.
- `src/tui/core/`: shared `EquipLayer`, reducer, controller and `ViewSpec`.
- `src/tui/hosts/opencode/`: package-dir server/TUI entries and RPC contract.
- `src/tui/skins/opentui/`: embedded renderer. Standalone/Pi use pi-tui.

The TUI plugin calls the generated client supplied by OpenCode. `/loadouts` is
registered in its client-side keymap; dashboard commands never become prompts.
Router data captures the originating session ID. The footer uses reactive slot
session IDs and native instruction/permission events, with no cache-file IPC.

## Verified probes

| Probe | Result |
|---|---|
| P1: session skill deny | **Live:** blocks the permission path but does **not** remove the skill advertisement. The server context hook filters denied `<skill>` blocks. Two sessions with opposite gates produced opposite advertisements. |
| P2: instruction entries | **Live:** first entry appears after `AGENTS.md` in the system instruction part; a replacement produces a native “supersedes” update in messages on the next turn. The original system prefix is retained — this is future-turn supersession, not history rewriting. A control session had no entry. |
| P3: local package dependencies | **Live:** local server package dirs do not install/resolve `@opencode/plugin` merely because it is declared in package.json. Server libraries are bundled. TUI host aliases resolve bare `@opencode/plugin/tui`, `@opentui/solid`, and `solid-js`; rewriting Solid to `solid-js/dist/solid.js` fails. |
| P4: global instructions | Source: `{global.config}/AGENTS.md`. The built-in renderer now writes `{base}/AGENTS.md`, normally `~/.config/opencode/AGENTS.md`. |
| P5: router reactivity | Dashboard target is explicitly captured in route data; footer receives reactive slot props. See [source evidence](opencode-v2-probes.md). |
| P6: cache hint | See [source evidence](opencode-v2-probes.md). Entries use the server's native caching/supersession behavior. No unmeasured cache-cost warning is shown. |

Source locations and remaining distinctions between source verification and live
observation are recorded in [opencode-v2-probes.md](opencode-v2-probes.md).

## Persistence and ownership

One instruction entry per nonempty loadout delta uses a readable, collision-safe
`loadouts.bundle.<slug>-<hash>` key. `loadouts.manifest` records names, source scope,
fingerprint, keys, selected skills, prior/applied permission rules and selections.
Keys satisfy `^[a-z0-9][a-z0-9._-]*$`. Each JSON-serialized UTF-8 value is checked
against the server's **256 KiB per-entry** limit before any mutation.

Permission replacement appends denies for unselected catalog skills to the prior
session rules. It never adds an allow that could override an agent's deny. The
activator waits for plugin activation before reading the initial catalog.
Unequip restores prior permissions only when the current rules still match those
Loadouts applied; external edits are preserved and reported. Unrelated instruction
entries are preserved. Re-equips remove obsolete owned keys.

Agent/model declarations are applied per session. Existing explicit selections
are restored on unequip unless subsequently changed externally. V2 has no API to
clear an explicit selection back to an implicit default; if there was no explicit
prior selection, the selected value remains after unequip.

Partial HTTP failures trigger rollback of entries, permissions and known previous
selections. An incomplete rollback is surfaced explicitly. Operations on one
session are serialized within a process. **The V2 APIs provide neither an atomic
multi-resource transaction nor compare-and-swap:** a process crash or simultaneous
mutations by different clients can interrupt or race an equip. Inspect session
status/entries/rules before recovering such a session. A model step can observe
intermediate state if equip overlaps that step; the completed equip governs the
next step.

## Server enhancements

The package server entry filters skill advertisements by session permission
rules. It indexes loadout skills via `skill.transform`, preserving existing
catalog IDs, and advertises selected off-disk skills per session. Those additions
are location-wide catalog entries, with automatic invocation disabled by default.
The manifest remains authoritative for off-disk advertisement selection.

Headless `/loadouts equip`, auto-equip via
`loadouts.yaml: opencode.defaultSession`, and typed RPC share the activator.
`Plugin.Context.session` lacks instruction-entry methods (still true in 2.0.32), so these
optional server operations discover the managed local service. They require that
service; the HTTP/TUI session activation path itself uses the connected client.
Without managed-service discovery, ordinary instruction entries and on-disk
permission filtering still work, and off-disk skills remain path references.

The deny list and virtual catalog are snapshots at equip/plugin load respectively.
Re-equip after changing skill membership; reload the plugin to index newly added
off-disk loadouts. Global/project filesystem skill changes remain native hot reload.

## Build and verify

```sh
npm run build
npm run lint
npm test
node scripts/opencode-session-e2e.mjs
OPENCODE_E2E_MODEL=provider/model node scripts/opencode-session-e2e.mjs --prompts
node scripts/opencode-session-restart-e2e.mjs
```

The first E2E harness creates and removes its own two sessions. `--prompts`
adds three model turns to verify the outgoing skill advertisements and instruction
supersession. The restart harness uses separate XDG config/state/data/cache roots
and stops only the service it created. Neither restarts the shared working service.

The OpenCode build uses Solid's **universal Babel transform**. Its host-owned
runtime imports stay external; the server implementation is self-contained.
Standalone still needs Node 22.19+ for pi-tui. OpenTUI requires Bun or Node 26.4+
with experimental FFI, and is only used inside OpenCode.

## V2 gotchas retained

- `instructions` in `opencode.json` is accepted but unresolved. Render instructions
  to `AGENTS.md`; never depend on that array.
- `POST …/skill` works on 2.0.3; the archived beta's failure is obsolete.
- Documentation uses `/api/experimental/session/…` for some operations while the
  installed API uses `/api/session/…`. Always use the generated client.
- Native instruction updates retain earlier context with supersession notices.
  Unequip changes future turns; it does not erase information the model has seen.
