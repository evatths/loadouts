# Fix: bump @opencode/* 2.0.3 → 2.0.32

**Tier:** one-commit-ish fix (build mode; single owner). Produced by headless
planner session `fix-plan: OpenCode dep bump 2.0.3 to 2.0.32` (2026-10-16);
API facts below were verified against the actual 2.0.32 `.d.ts` files on unpkg.

## Verified breaking changes (d.ts diff 2.0.3 → 2.0.32)

1. `client.permission.rules({sessionID, permissions})` — **removed**.
   Replacement: `client.session.update({sessionID, permissions})`, identical
   `{action, resource, effect}` rule shape (`SessionUpdateInput.permissions`).
2. `client.plugin.awaitActivation` — **route removed entirely**. Replace with a
   bounded poll of `client.plugin.check()` until the loadouts entry reports
   `state.status === "active"` (`PluginInfo.state`), preserving session.ts's
   "read skill catalog only after activation" invariant.
3. `client.health.get()` — **removed**; replaced by `client.server.info()` →
   `ServerInfo.version`.
4. Everything else loadouts consumes is intact (verified directly):
   `Service.discover/headers`, `session.instructions.entry.*`,
   `switchAgent/switchModel`, `skill.list({location})`,
   `SessionInfo.{agent,model,permissions,time.archived,parentID,location.directory}`,
   `InstructionEntryInfo`, `JsonValue`, `PermissionRuleset`,
   `ctx.session.hook("context")`, `ctx.skill/command.transform`,
   `ctx.rpc.register`, `@opencode/plugin/tui`, `Rpc`, `@opencode/schema`
   `AbsolutePath`. Effect-context and `ToolContext` additions are additive.

## Decisions

- **Exact pins, not caret.** Three client APIs were removed in one patch-month;
  a caret would let a fresh `npm install` silently break the bundled plugin.
  Bump `@opencode/plugin`, `@opencode/client`, `@opencode/theme` → exact
  `2.0.32`; bump `@opentui/{core,keymap,solid}` 0.5.11 → `0.5.17` (theme
  2.0.32 peer requires ≥0.5.17; `solid-js` 1.9.15 already satisfies its peer).
- **Binary:** run `opencode upgrade` (2.0.26 → 2.0.32) so the runtime matches
  the tested version; `client.ts`'s version-warning banner keys off
  `TESTED_OPENCODE_VERSION`.

## Edits

1. `package.json` — the bumps above.
2. `src/integrations/opencode/client.ts` — `health.get()` → `server.info()`;
   `TESTED_OPENCODE_VERSION = "2.0.32"` (line 6).
3. `src/integrations/opencode/session.ts` — both `permission.rules` call sites
   (commit ~line 152, rollback ~line 161) → `session.update`; `SessionClient`
   picks: add `"update"` to session, drop the now-unused `permission`
   namespace; swap `awaitActivation` (line 75) for the `plugin.check` poll.
4. `src/integrations/opencode/session.test.ts` — update client stubs to the new
   `SessionClient` shape.
5. `src/tui/hosts/opencode/*` — no changes expected; lint confirms.

**Regeneration:** `npm install && npm run build`. MEMORY's `build:embedded`
rule has the same root cause here: `scripts/build-embedded.mjs` line 224
*bundles* `@opencode/*` into `bundled/opencode/plugins/loadouts/index.js`, so a
bump without rebuild ships a stale plugin.

## Verification

1. `npm ls @opencode/client @opencode/schema` — single 2.0.32 copy, no
   duplicate types.
2. `npm run lint && npm test`.
3. `opencode upgrade`, restart service, `node scripts/opencode-session-e2e.mjs`
   — equip/unequip/status round-trip proving permissions via `session.update`.
4. `node scripts/opencode-session-restart-e2e.mjs` (isolated XDG service);
   `npm run loadouts -- status` smoke.

## Assumptions

- If the e2e shows 2.0.32 activation completes before `skill.list` can observe
  stale state, drop the poll rather than keep it.
