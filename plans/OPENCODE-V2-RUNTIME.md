# OpenCode V2 Runtime: Re-imagined

Status: **Implemented; verification recorded below** — supersedes `plans/OPENCODE-RELOAD-PLUGIN.md` and the
V1-shaped `src/integrations/opencode-runtime/` + `src/tui/hosts/opencode/`.
Grounding: opencode `v2.0.3`, `@opencode/plugin@2.0.3`, `@opentui/*@0.5.11`,
2026-09-14. Sources: live `/openapi.json` from the running service, published
`.d.ts` tarballs, source at tag `v2.0.3`, `/v2/docs/`. Every claim below is
tagged **V** (verified in source/spec/.d.ts) or **P** (needs a probe before we
build on it). Predecessor design notes live in `docs/opencode-v2-runtime.md`
(stamped beta-18707); this plan records what changed since.

## Execution record (2026-09-14)

- **Phase 0:** V1 integration and bundled artifacts removed; V2 dependencies,
  plugin-dir kind and global instruction target updated. P1/P2/P3 tested live;
  P4/P5/P6 grounded in 2.0.3 source/types. Historical beta notes archived.
- **Phase 1:** SessionActivator + CLI implemented. Fake-client tests cover
  isolation, replacement, rollback, limits, external permission edits and
  selection restoration. Live two-session and isolated service restart proofs pass.
- **Phase 2:** Package-dir plugin, local slash/keymap command, router dashboard,
  G/P/S footer and quick-equip overlay implemented. Dashboard equip and live
  session footer exercised through a real OpenCode TUI; control session unaffected.
- **Phase 3:** P1 confirmed advertisement filtering is required. Implemented
  filtering, off-disk catalog transform, headless command, default-session event
  handler and RPC. Optional entry-API server operations require the managed
  service because Plugin.Context.session lacks instruction-entry methods in 2.0.3.
- **Phase 4:** Standalone session picker and Pi actual-session-ID lifecycle
  implemented on the shared reducer/controller. Pi persistence uses custom entries.

**Probe-driven corrections:** local plugin dirs do not install server dependencies;
the server build bundles its libraries. TUI bare `solid-js` must remain a host
alias, not a `dist/solid.js` import. OpenCode 2.0.3 itself uses OpenTUI 0.5.10;
the build's 0.5.11 types/compiler were tested against that host. Entries supersede
prior context through native messages; they do not replace history. Permission
writes publish after the manifest so native events can refresh other clients.
No API transaction/CAS exists; crash/cross-client concurrency limits are explicit
in [the implementation reference](../docs/opencode-v2-runtime.md).

Reproducers: `scripts/opencode-session-e2e.mjs` (`--prompts` for model-call proof)
and `scripts/opencode-session-restart-e2e.mjs` (isolated XDG roots).
Detailed source evidence: [docs/opencode-v2-probes.md](../docs/opencode-v2-probes.md).

The original scoped design follows; the implementation reference records deviations.

---

## 1. What changed the problem

Three V2 facts collapse most of the old runtime's complexity.

| Fact | Consequence for Loadouts |
|---|---|
| **Hot reload is native and running sessions see it.** V2 watches the global config dir, every project config root, `AGENTS.md` (global + ancestor walk), skill dirs (following symlinks), commands, agents, plugin dirs, MCP and reference config. Each consumer debounces 100 ms. Instruction hashes are diffed per model call against the session's stored values; a change renders a "changed and supersedes" notice into the *running* session before its next turn. **V** (`core/src/config/watch.ts`, `config/plugin/{instruction,skill,command,agent,source}.ts`, `session/context.ts`, `instructions/index.ts`) | `loadouts activate/sync` is now *live* for OpenCode. No `/reload`, no instance-dispose plan, no restart prompt. The only remaining reasons for a "runtime" are **per-session isolation** and **not touching disk**. |
| **Per-session state is a first-class, persisted, plain-HTTP surface.** `PUT /api/session/{id}/instructions/entries/{key}` (256 KiB/entry, SQLite-backed, rendered as `<context key>` in the system prompt *after* AGENTS.md) and `PUT /api/session/{id}/permission/rules` (replaces a persisted session ruleset, evaluated after the agent's rules, last-match-wins, `action: "skill"` is asserted by the skill tool). Plus `POST …/skill`, `…/agent`, `…/model`, `…/synthetic`. **V** (`core/src/session/instruction-entry.ts`, `permission.ts`, `tool/plugin/skill.ts`, spec) | Session-scoped instruction/rule injection and skill gating need **no server plugin**. Anything with an authenticated client — the TUI plugin, the CLI, a test — can equip a loadout on one session without affecting any other. |
| **The TUI plugin surface is rich and client-side.** `keymap.layer` slash commands with `arguments: true` run locally and never reach the model; `ui.router.register` gives a full-screen page; `session.panel` supports `presentation: "fullscreen"`; `context.client` is the full generated `@opencode/client`; `context.data.location.skill.list()` etc. are reactive projections of server state; `storage.store` is durable and cross-TUI synced. **V** (`dist/tui/context.d.ts`) | `/loadouts` and the dashboard live entirely in the TUI plugin. No cache-file IPC, no polling, no sentinel errors. |

Two facts constrain the design:

- **`@opentui` needs Node ≥ 26.4 + `--experimental-ffi`, ESM-only** (or Bun). **V** (ran hello-world on Node 26.8.2; fails on 22/23). A standalone `loadouts tui` on ordinary Node LTS cannot use it. The pi-tui / opentui skin split stays — and it is the *right* call, not a compromise. Corroborating: OpenCode's own Node artifact (`@opencode/cli-node`, published on non-latest channels) is also built against Node **26.4.0** — upstream's Node floor and opentui's are the same, so opentui-under-Node is a credible future direction, just not for an npm CLI with `engines: >=18` today. **V** (`packages/cli/script/{build-node.ts,publish.ts}`)
- **Skill catalog is location-wide.** Skills bind at discovery time; `skill.transform` mutates the shared catalog. Per-session skill *sets* therefore come from gating (session permission rules) over the on-disk catalog, not from adding skills per session. **V**

Also a real gotcha surfaced: the `instructions` array in `opencode.json` is **accepted but not resolved in V2** (docs say so; no consumer in `packages/core`). **V** Loadouts must never route OpenCode instructions through it — render to `AGENTS.md` only, which is what the `opencode` tool spec already does.

---

## 2. The model: three equip layers

Call of Duty framing. A **loadout** is a class. You **equip** it into one of three slots, from widest to narrowest:

```
┌─ GLOBAL ─────────┐  ~/.config/loadouts/.state.json → ~/.config/opencode/*   every session, every project
├─ PROJECT ────────┤  .loadouts/.state.json          → .opencode/*, AGENTS.md  every session in this project
└─ SESSION ────────┘  instruction entries + permission rules on ONE session    this conversation only
```

| Layer | Bind time | Mechanism | Persistence | Who can drive it |
|---|---|---|---|---|
| Global / Project | Discovery (hot-reloaded) | Existing render engine → files on disk | `.state.json` | CLI, standalone TUI, embedded TUI |
| Session | Assembly (per model call) | `SessionActivator` over `@opencode/client` | OpenCode SQLite (entries + rules) | embedded TUI, CLI (`--session`), server plugin (optional) |

The session layer **injects only the delta** against what Global + Project already put on disk: entries render after `AGENTS.md`, so re-injecting the same text double-counts tokens and can conflict (old §7.5). The `RuntimeBundle` compiler gains an `exclude` set derived from the two `.state.json` files.

### 2.1 Session activation, artifact by artifact

| Artifact | Mechanism | Scope | Status |
|---|---|---|---|
| instructions, rules | `instructions.entry.put` — one key per loadout: `loadouts.<name>` (manifest in `loadouts.manifest`) | per-session, persisted | **V** |
| skills already on disk (equipped globally/project) | `permission.rules` → deny-list every catalog skill not in the loadout (or allow-list + wildcard deny) | per-session, persisted, **enforced** by the skill tool | **V** enforcement; **P1** whether it also hides from `<available_skills>` |
| skills *not* on disk | v1: path-discovery text inside the instruction entry (existing `RuntimeSkillRef`). v2: server plugin `skill.transform` + advertisement rewrite | v1 per-session; v2 catalog-wide + per-session visibility | **V** / **P** |
| agent, model | `session.switchAgent` / `switchModel` when the loadout declares one | per-session, persisted | **V** |
| commands, MCP, references, plugins | not session-scopable (discovery-time). Equip at Project/Global. | — | **V** |

Deactivate = `entry.remove` for our keys + `permission.rules({ permissions: [] })` (only if we own the ruleset — record prior rules in the manifest entry and restore them).

OpenCode announces entry changes to the model itself ("The context under X changed and supersedes…"), so we drop our own acknowledgment text. **V**

---

## 3. Architecture

```
src/tui/core/                 Elm core: Model/Intent/update/view/ViewSpec      (exists, keep, tests pass)
src/tui/skins/pi-tui/         standalone + Pi projection                       (exists, keep)
src/tui/skins/opentui/        embedded OpenCode projection                     (exists, WIP → finish on 0.5.11)
src/integrations/opencode/
  session.ts                  SessionActivator(client): equip/unequip/status   (new, pure, fake-client tests)
  delta.ts                    bundle − on-disk state → entries + rules          (new)
  client.ts                   discover service (@opencode/client/service)       (new; CLI + standalone only)
src/tui/hosts/opencode/
  index.ts                    server entry: Plugin.define({ id, setup })        (rewrite; near-empty in phase 2)
  tui.tsx                     TUI entry: router page, slash, slots, dialogs     (rewrite)
  rpc.ts                      Rpc.define contract                               (phase 3)
bundled/opencode/plugins/loadouts/   package dir: package.json{exports}, index.ts, tui.tsx
```

### 3.1 `SessionActivator` — the one new core abstraction

Replaces `RuntimeInjector` in `src/tui/core/host.ts` and the whole
`opencode-runtime/{plugin,state,bridge}.ts` persistence layer.

```ts
interface SessionActivator {
  equip(sessionID, names: string[], opts: { scope: "global" | "project"; excludeOnDisk?: boolean }): Promise<EquipResult>
  unequip(sessionID): Promise<void>
  status(sessionID): Promise<{ names: string[]; fingerprint: string; equippedAt: string } | undefined>
}
```

Implementation is ~150 lines over `client.session.instructions.entry.*`,
`client.permission.rules`, `client.session.switchAgent/switchModel`,
`client.skill.list({ location })`. State lives in the `loadouts.manifest`
entry itself — server-side, visible to every client, no plugin storage. The
same object is constructed from `context.client` in the TUI plugin and from
`Service.discover()` + `OpenCode.make()` in the CLI.

### 3.2 Embedded TUI plugin (package dir)

- **Shape:** directory with `package.json` `exports: { ".": "./index.ts", "./tui": "./tui.tsx" }`. Single files are dropped by the loader. **V** Your `~/.config/opencode/plugins/context-sidebar/` is the live template.
- **`/loadouts`**: `keymap.layer` command with `slash: { name: "loadouts", arguments: true }`, `palette: true`, `bind: "ctrl+l"` (configurable via `context.options`). Bare `/loadouts` → `ui.router.navigate({ type: "plugin", name: "loadouts" })`. `/loadouts equip x y` → `SessionActivator.equip` + toast. Never touches the model. **V**
- **Dashboard page:** `ui.router.register({ name: "loadouts", render })` renders `Dashboard(spec)` from the opentui skin. Current session from `ui.router.current()` captured on open (**P5**: reactivity). Back = `navigate({ type: "session", sessionID })`.
- **Quick-equip overlay:** `ui.dialog.show(<Select…/>)` for the fast path (space toggles, enter equips).
- **EQUIPPED bar:** `ui.slot({ append: "prompt.footer.status", render: ({ sessionID }) => … })` showing `G base·meta  P backend  S caveman(a1b2c3)`. Live via `context.data.on("session.instructions.updated", …)` (event `SessionInstructionsUpdated` exists **V**).
- **Data:** loadout catalog from `src/tui/core/data.ts` (direct core import, bundled); OpenCode catalog from `context.data.location.skill.list()` / `agent.list()`.
- **Theme:** `context.theme` → `ThemeTokens` (`toOpenTuiTheme` exists; re-map to `ResolvedTheme` groups `text/background/border`).
- **Deps to bump:** `@opencode/plugin@2.0.3`, `@opentui/{core,solid}@0.5.11`, `solid-js@1.9.15`; drop `@opencode-ai/plugin`. JSX pragma `/** @jsxImportSource @opentui/solid */` exact. **V**

### 3.3 Model changes in `src/tui/core`

- `ActivationMode = "filesystem" | "runtime"` → `EquipLayer = "global" | "project" | "session"`. Rows carry `equipped: EquipLayer[]` (a loadout can be in several).
- `Effect.apply/clear` carry `layer`. `actions.ts` routes `session` to `SessionActivator`, others to the render engine as today.
- `ViewSpec.footer.equipped` becomes three spans (G/P/S).
- Standalone host hides the session layer unless an OpenCode service is discoverable (phase 4).

### 3.4 CLI

```
loadouts session status   [--session <id>]        # default: most recent session at cwd
loadouts session equip    <names…> [--session <id>] [-g|-p]
loadouts session unequip  [--session <id>]
loadouts session list                                # sessions at this location
```

Uses `@opencode/client/service` `Service.discover()` (never spawns) + Basic auth from the registration file. **V** This is also the E2E harness: create a session via API, equip, `POST …/prompt "reply ok"`, read `GET …/context` for the `<context key="loadouts.…">` update message.

### 3.5 Server plugin (phase 3, optional)

Only for what HTTP cannot do:

- `session.hook("context")` to rewrite `<available_skills>` per session (if **P1** says session deny does not hide) and to push off-disk skill advertisements. Part shape `{ type: "text", text, cache?, metadata? }` **V** — use `cache` to keep the injected block cache-friendly (**P6**).
- `skill.transform` to add loadout skills to the catalog without `loadouts sync` writing files.
- `event.subscribe` → on `session.created`, auto-equip a per-project default (`loadouts.yaml: opencode.defaultSession`).
- `command.transform` `/loadouts` for headless `opencode run` sessions — `execute({ sessionID, prompt })` is silent by construction. **V**
- `rpc.register` for typed TUI↔server events instead of polling `data.on`.

### 3.6 Distribution

Two paths, same package dir:

1. **Local (dev, dotfiles):** `bundled/opencode/plugins/loadouts/` rendered to `{base}/plugins/loadouts/` as a directory. Needs a dir-layout OpenCode plugin kind (`opencode-plugin` is `layout: "file"`; add `opencode-plugin-dir` mirroring `extension-dir`). Import resolution of `@opencode/plugin/tui` and `@opentui/solid` from a dir without its own `node_modules` is **P3**.
2. **Published:** `@loadouts/opencode` on npm; `opencode-config` kind renders `plugins: ["@loadouts/opencode@<ver>"]`. OpenCode installs into `~/.cache/opencode/npm/` and hot-reloads on config change. **V** Robust default for non-dotfiles users.

---

## 4. Probes before building (cheap, ~1 hour total)

Run in a scratch dir under `/tmp/opencode/` with a no-import probe plugin (`docs/opencode-v2-runtime.md` §8.1 recipe) and `opencode run`. Never `service restart` from a live session.

| # | Question | Why it matters | Method |
|---|---|---|---|
| **P1** | Does a *session* `skill` deny rule remove the skill from `<available_skills>`, or only block the tool? | Decides whether phase 2 alone gives clean per-session skill sets or phase 3's advertisement rewrite is required | Probe context hook dumps `system` parts; `PUT …/permission/rules` deny on a control skill; compare |
| **P2** | Confirm `<context key="loadouts.x">` lands as a system part after AGENTS.md and the "supersedes" notice appears on a second `PUT` | Validates the zero-plugin path end to end | Same probe; two PUTs, two turns |
| **P3** | Does a local plugin *dir* without `node_modules` resolve `@opencode/plugin/tui` + `@opentui/solid`? | Chooses distribution path 1 vs 2 as default | Copy `context-sidebar` to `/tmp`, strip deps, load via `cli.json` |
| **P4** | Global `AGENTS.md` discovery path: `~/.config/opencode/AGENTS.md` vs `~/AGENTS.md` | `src/builtins/tools/opencode.ts` renders global instructions to `{home}/AGENTS.md`; if V2 only reads the config-dir one, global instruction activation is silently broken | Read `core/src/config/plugin/instruction.ts` candidates; `opencode debug config` |
| **P5** | Is `ui.router.current()` reactive inside Solid computations? | EQUIPPED bar / page must track session switches | Tiny TUI plugin logging in a `createEffect` |
| **P6** | `CacheHint` shape on `SystemPart.cache` | Prompt-cache cost of mid-session switching | `.d.ts` in `@opencode/ai/dist/schema/messages.d.ts` |

---

## 5. Phases

Each phase ships something usable on its own.

**Phase 0 — Clear the deck (½ day)**
- Delete `src/integrations/opencode-runtime/`, `src/tui/hosts/opencode/embed-entry.tsx`, `bundled/opencode/plugins/loadouts-runtime*.{ts,tsx}`, `bundled/opencode/tui.jsonc`, `bundled/opencode/commands/loadouts.md`. Mark `plans/OPENCODE-RELOAD-PLUGIN.md` superseded.
- Re-stamp `docs/opencode-v2-runtime.md` to 2.0.3 with: entry limit 256 KiB/entry, `POST …/skill` now works, session permission rules exist, `instructions` config unresolved, opentui Node constraint, `/api/experimental/` prefix drift in docs vs live spec.
- Fix `RUNTIME_CAPABILITY_MATRIX.opencode`: `nativeSkillHotSwap` is true (location-wide); add `sessionInstructionEntries: true`, `sessionSkillGating: true`.
- Bump deps; run P1–P6; record results in the doc.

**Phase 1 — `SessionActivator` + CLI (1–2 days)**
- `src/integrations/opencode/{session,delta,client}.ts` with fake-client unit tests.
- `loadouts session {status,equip,unequip,list}`.
- E2E script via the API (replaces `runtime-injection-e2e`).
- Exit: two sessions at one location, disjoint instruction sets and skill gates, survive `service restart`.

**Phase 2 — Embedded dashboard (3–4 days)**
- Package-dir plugin; `/loadouts` slash + `ctrl+l`; router page on the opentui skin; EQUIPPED footer slot; quick-equip dialog.
- Core model: `EquipLayer`, three-span footer.
- Kind: `opencode-plugin-dir`; render to `{base}/plugins/loadouts/`.
- Exit: equip/unequip a session from the dashboard, EQUIPPED updates live, other sessions untouched, TUI hot-reloads plugin edits.

**Phase 3 — Server plugin enhancements (2 days, gated on P1)**
- Advertisement rewrite / off-disk skills via `skill.transform`; `session.created` auto-equip; RPC contract; headless `/loadouts`.

**Phase 4 — Control tower + Pi parity (2 days)**
- Standalone pi-tui host discovers a running service and offers the session layer across sessions ("equip this class on *that* conversation").
- Pi host: same `EquipLayer` model, session layer via `before_agent_start`.

---

## 6. Non-goals (still)

- No session-history surgery; future-turn semantics only.
- No per-session *catalog* (skills, commands, MCP) — OpenCode binds those at discovery. We gate, we do not fork.
- No `/reload`. Hot reload is OpenCode's job now.
- No opentui for standalone until Node's FFI is stable and our `engines` can move.

---

## 7. Open risks

- **API churn.** Docs already show `/api/experimental/session/…` prefixes the installed service lacks. Always go through `@opencode/client` (generated per version), never raw paths; pin `@opencode/client` to the minor we test against and warn on `GET /api/health` version mismatch.
- **Advertisement string surgery** (phase 3) is fragile by nature; keep it a no-op when the marker is missing.
- **Prompt cache** invalidation on switch — measure with P6; warn in the equip toast on long sessions.
- **Compaction** — the context hook does not run for compaction; entries do (they are instruction sources), which is a point in favour of the entries-first design.
