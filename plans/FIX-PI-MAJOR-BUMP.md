# Plan: bump pi-tui / pi-coding-agent 0.79.7 → 1.3.0 (done 2026-10-18)

## Decision: straight to exact `1.3.0`

The only break that touched us (the `TUI` value export) landed by 0.84.0, so an
intermediate 1.0.0 stop buys nothing. Pinned exact because pi-coding-agent 1.3.0
pins `pi-tui` to exactly `1.3.0`; a caret on our side could install a second
copy and split `Component` type identity / runtime classes.

## Changes

1. `package.json`: both packages → `1.3.0` (pi-coding-agent stays a type-only devDependency).
2. `src/tui/hosts/standalone.ts`: `TUI` is type-only in 1.x (undocumented in the
   changelog); construct `TuiMainScreen` (main-screen renderer, same behavior as the
   old `TUI`). `TuiAltScreen` is the fullscreen variant.
3. `scripts/build-embedded.mjs`: the Pi extension `package.json` now declares
   `peerDependencies: { "@earendil-works/pi-tui": "*" }`. Pi ≥0.99 warns on
   host-provided modules in `dependencies` (docs/packages.md, "Dependencies").

Unaffected (verified against 1.3.0 `.d.ts`): `before_agent_start` became a
`messageType` union but `systemPrompt` is on the shared base; `ctx.ui.custom`,
`Theme.fg/bg` tokens incl. `selectedBg`, session-manager accessors, `Key`,
`matchesKey`, `decodeKittyPrintable`, `visibleWidth`, `truncateToWidth`,
`OverlayHandle`/`OverlayOptions`. 1.2.0 `$schema` files: out of scope (we don't
render Pi settings/themes).

## Node floor: unchanged

0.79.7 and 1.3.0 both declare `engines.node >=22.19.0`. `legacy-node20` (0.74.2)
is a downgrade to an older API and still above our Node 18 CLI floor — not a
fallback. If 1.3.0 misbehaves, revert to exact `0.79.7` and fix forward.

## Verification (all run)

- `npm ls @earendil-works/pi-tui` → single deduped 1.3.0.
- `npm run lint` clean; `npm test` 28 files / 269 tests pass.
- `npm run build` → `bundled/extensions/loadouts-runtime/package.json` has the peer dep.
- tmux smoke of `node dist/index.js tui`: renders, `j` moves, `?` overlay, Ctrl-C exits 0.
- Not run: `/loadouts` inside a live Pi 1.3.0 host.
