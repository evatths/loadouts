# OpenCode V2 Runtime: Context Injection & Replacement

> Historical beta-18707 investigation. The implemented 2.0.3 integration is
> documented in [../opencode-v2-runtime.md](../opencode-v2-runtime.md).
> API names, limits, and recommendations below are preserved as historical evidence.

Design reference for rewriting the `opencode-runtime` loadout. The V1 runtime
(`.opencode/plugins/loadouts-runtime.ts`) targeted the V1 plugin API and is
**dead on V2** — it cannot load at all. This document records what V2 actually
offers, which parts were verified empirically, and how to build a runtime that
switches loadouts mid-session with per-session configuration.

## Verification environment

| Item | Value |
|---|---|
| Build | `0.0.0-beta-18707` (CLI binary `opencode2`) |
| Plugin package | `@opencode-ai/plugin@0.0.0-beta-18707` |
| Date | 2026-08-31 |
| Method | Throwaway server plugin in `/tmp/opencode/v2probe/.opencode/plugins/probe/`, results appended to a file, exercised with `opencode2 run`; plus live `opencode2 api` calls against the background service |

Everything below is tagged **VERIFIED** (observed on this build) or
**DOCUMENTED** (from <https://opencode.ai/v2/docs>, not independently
confirmed). Do not trust the DOCUMENTED rows without a probe — the docs are
already wrong in at least one load-bearing place (see the system-part shape
gotcha in §3.2).

## What changed from V1

The V1 runtime made three assumptions. Two are now false.

| V1 assumption | V2 reality |
|---|---|
| Plugin = default-exported async function returning a hook map | **False.** Loader requires an object `{ id, setup }`. Function exports fail with `SchemaError(Expected object at ["default"])`. |
| `nativeSkillHotSwap: false` — skills can only be advertised by path | **False.** `ctx.skill.transform()` adds/updates/removes skills at runtime and they appear in the skill list. |
| Instructions/rules injected via `experimental.chat.system.transform` | Renamed and restructured: `ctx.session.hook("context", …)`, plus a **native per-session instruction API** that needs no plugin at all. |

The V1 design instinct was right — key state by `sessionID`, inject a system
block, persist across restarts. V2 supplies first-class primitives for all
three, so the new runtime should be substantially smaller than the old one.

## Contents

1. [Bind time: the model that governs everything](#1-bind-time)
2. [Server plugin shape and loading](#2-server-plugin-shape-and-loading)
3. [Per-session injection mechanisms](#3-per-session-injection-mechanisms)
4. [Catalog mutation mechanisms](#4-catalog-mutation-mechanisms)
5. [State, transport, and UI](#5-state-transport-and-ui)
6. [Recommended architecture](#6-recommended-architecture)
7. [Constraints and open questions](#7-constraints-and-open-questions)
8. [Repro recipes](#8-repro-recipes)

---

## 1. Bind time

Every "can this vary per session?" question reduces to **when the value is
resolved**. V2 has three bind times, and the runtime must use a different
mechanism for each.

| Bind time | Resolved | Examples | Varies per session? |
|---|---|---|---|
| **Discovery** | When a *location* loads; cached until evicted or reloaded | skill list, commands, agents, MCP servers, references | No — location-wide. Mutable at runtime via transforms + `reload()`, but the result is still shared by every session at that location. |
| **Assembly** | On every model call | system parts, messages, tools exposed, generation settings | **Yes** — `session.hook("context")` receives `sessionID`. |
| **Persistence** | Written once, replayed into assembly | instruction entries, synthetic messages, session agent/model | **Yes** — stored against the session by the server. |

Consequences for the runtime:

- **Instructions and rules** are trivially per-session: they are assembly-time
  content. Two mechanisms exist (§3.1, §3.3); pick by whether you want the
  server to persist them for you.
- **Skills** are discovery-time. `skill.transform` can add or remove them
  live, but the effect is location-wide, not session-scoped. Making skills
  *appear* per-session requires gating at assembly time (§7.1).
- **Agents** are discovery-time definitions with a per-session *selection*.
  Switching the agent is the cheapest per-session behavior change available.

A useful sanity check when designing: if a value is read while building the
prompt, it can be session-scoped; if it is read while indexing the filesystem,
it cannot.

---

## 2. Server plugin shape and loading

### 2.1 Required export shape — VERIFIED

```ts
import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "loadouts.runtime",
  async setup(ctx) {
    // register transforms and hooks here
    return () => {
      /* optional cleanup on unload */
    }
  },
})
```

`Plugin.define` is a typing/identity helper. The loader validates the
*shape*, so a plain object literal `{ id, setup }` loads identically and
without the dependency — useful for probes:

```ts
export default { id: "probe", async setup(ctx: any) { /* … */ } }
```

Observed loader failures on this build, all from V1-era shapes:

| Export | Error |
|---|---|
| `export default async function(ctx) { return { hooks } }` | `SchemaError(Expected object at ["default"])` |
| object missing `setup` | `SchemaError(Missing key at ["default"]["setup"])` |
| any shape, unresolvable import | `Die(ResolveMessage: Cannot find package '@opencode-ai/plugin')` |

Currently failing this way in Evatt's environment on every startup:
`wrap-it-up.ts`, `wrap-it-up-v2.ts`, `workmux-status.ts`,
`opencode-rules@latest`, and the V1 `loadouts-runtime.ts`.

### 2.2 Loading and resolution — VERIFIED

- Plugins in `<location>/.opencode/plugins/` load automatically. Packages and
  other paths go in `opencode.json(c)` under `plugins`.
- **Import resolution is not the plugin's own directory.** Installing
  `@opencode-ai/plugin` into the project (`bun add`) still produced
  `Cannot find package` for a plugin under `.opencode/plugins/`. Publish the
  runtime as a package, or avoid the import in loose local files.
- Pin the plugin package to the running build. `bun add
  @opencode-ai/plugin@beta` resolved to exactly `0.0.0-beta-18707`, matching
  the binary. The API is beta and shapes move between builds.

### 2.3 Reload semantics — VERIFIED, with a trap

- `setup` re-runs when the location reloads; registrations from a previous
  load **persist in the running process** until disposed or the location is
  genuinely evicted. During probing, a hook kept firing after its plugin file
  had been rewritten, producing results that looked impossible.
- `DELETE /api/debug/location?location=<dir>` returned success but the
  directory remained in `GET /api/debug/location`, and `setup` did not re-run.
  Treat eviction as unreliable.
- `opencode2 service restart` forces a clean load **and kills every attached
  client**, including the session you are working in. Do not call it from
  inside a session you care about.
- Registrations expose `dispose()`; prefer disposing and re-registering over
  attempting to reload the location.

`ctx` keys observed at setup on this build:

```
agent, aisdk, app, catalog, command, event, experimental, generate,
integration, location, mcp, options, permission, plugin, reference,
session, shell, skill, storage, tool, vcs, websearch
```

---

## 3. Per-session injection mechanisms

### 3.1 `session.hook("context")` — the primary injection point — VERIFIED

The direct replacement for V1's `experimental.chat.system.transform`, and the
mechanism the new runtime should be built around.

```ts
await ctx.session.hook("context", (event) => {
  // event.sessionID, event.agent, event.model are readonly
  event.system.push({ type: "text", text: renderSystemBlock(bundle) })
})
```

Observed firing on a real turn:

```
context-hook=FIRED session=ses_fa9e92a52ffeeg8xFfdzaS5BVI agent=build
             systemPartsBefore=2 tools=14 messages=1
```

Properties:

- Runs **on every model call**, including tool-driven continuations. Does
  **not** run for title generation or compaction requests.
- Mutations affect only the outgoing request — nothing is persisted to session
  history or config. Perfect for swappable config: stop pushing and the next
  turn is clean.
- Gives you `system` (parts), `messages`, `tools`, `generation`, and
  `providerOptions`. Deleting `event.tools.write` removes that tool for this
  call only — a per-session tool policy without touching permissions.
- Hooks run in registration order and see earlier hooks' edits.
- Optional `{ providerID }` scoping for provider-specific tweaks.

**Gotcha — the docs are wrong.** The official example pushes `{ text: "…" }`.
On beta-18707 that makes every turn fail with `Error: Schema validation
failed`. The required shape is tagged:

```ts
event.system.push({ text: "…" })                   // ✗ Schema validation failed
event.system.push({ type: "text", text: "…" })     // ✓ works
```

Isolated by bisection: a control directory with no plugin ran clean; removing
the injected skill did not fix it; changing only the part shape did.

### 3.2 Instruction entries API — native, persisted, no plugin — VERIFIED

The server stores arbitrary instruction entries **per session** and replays
them into the prompt. No plugin required.

```
GET    /api/session/{sessionID}/instructions/entries
PUT    /api/session/{sessionID}/instructions/entries/{key}   body: { "value": … }
DELETE /api/session/{sessionID}/instructions/entries/{key}
```

Isolation proof:

```bash
opencode2 api put /api/session/$A/instructions/entries/probe \
  -d '{"value":"Probe instruction: respond in haiku."}'

opencode2 api get /api/session/$A/instructions/entries
# {"data":[{"key":"probe","value":"Probe instruction: respond in haiku."}]}

opencode2 api get /api/session/$B/instructions/entries
# {"data":[]}        ← control session unaffected
```

Notes:

- Keyed, so a runtime can own key `loadouts` and replace it wholesale on
  switch, leaving other producers' entries intact. `DELETE` is a clean
  deactivate.
- Survives restarts without hand-rolled cache files (V1 wrote
  `~/.cache/loadouts/opencode-runtime/<sha256(cwd)>.json` — no longer needed).
- `PUT` can return **413**; there is an
  `InstructionEntryValueTooLargeError`. A full multi-loadout instruction blob
  may exceed it — chunk across keys or fall back to the context hook. The
  exact limit was not measured.
- Only surfaces entries for sessions the server currently has loaded; a
  request against a session belonging to an unloaded location returned an
  empty body.

**Choosing between 3.1 and 3.2:** the context hook is ephemeral, unlimited in
size, and requires a live plugin; instruction entries are persisted, size
limited, and work even with no plugin loaded (e.g. from a CLI or the TUI
plugin directly). A runtime can use both: entries as the durable record,
the hook for large or computed content.

### 3.3 `session.hook("prompt")` — per-prompt attachment — DOCUMENTED

```ts
await ctx.session.hook("prompt", (event) => {
  event.skills.push("shorehouse-research")   // resolved through the normal path
  event.files ??= []
  event.files.push({ uri: "file:///project/policy.md" })
  event.delivery = "queue"
})
```

Runs once per admitted user prompt (not per model call), and its edits become
the **canonical persisted user input**. Notably it can add `skills` to a
prompt — the closest thing to session-scoped skill activation. Does not run
for synthetic messages, shell messages, or compaction. Cannot be scoped by
provider. Must be retry-safe: concurrent submissions may run it more than once.

### 3.4 Session-scoped selections — DOCUMENTED

```ts
await ctx.session.switchAgent({ sessionID, agent: "planner" })
await ctx.session.switchModel({ sessionID, model: { providerID, id } })
await ctx.session.synthetic({ sessionID, text: "Loadout switched to review" })
await ctx.session.command({ sessionID, command: "review", arguments: "--staged" })
```

`switchAgent` is the cheapest real per-session config change: agents carry
their own prompt, model, tools, and skill permissions. If a loadout maps
cleanly onto an agent, prefer this over injection.

`POST /api/session/{id}/skill` (`{ skill, id?, resume? }`) activates a skill
into a session, adding its Markdown body to that session's context — a
per-session skill push, complementary to the location-wide `skill.transform`.

### 3.5 Advertisement rewriting — per-session skill lists with the SAME agent — VERIFIED

The `<available_skills>` block is not magic: it arrives as a **system part**
that the context hook can rewrite per session. This gives per-session skill
visibility without `switchAgent` and without touching the catalog.

Probe results, same agent (`build`), same location, same on-disk catalog:

```
turn 1: agent=build strip=false adBefore=true           ← untouched
turn 2: agent=build strip=true  adBefore=true adAfter=false
```

```ts
await ctx.session.hook("context", (event) => {
  const runtime = runtimes.get(event.sessionID)   // key by session, not by message
  if (!runtime?.hiddenSkills?.length) return
  const part = event.system.find(
    (p) => typeof p?.text === "string" && p.text.includes("<available_skills>"),
  )
  if (!part) return
  for (const id of runtime.hiddenSkills) {
    part.text = part.text.replace(new RegExp(`<skill>\\s*<id>${id}</id>[\\s\\S]*?</skill>`), "")
  }
})
```

Caveats:

- **String surgery on the block format.** The `<skill><id>…</id>…</skill>`
  shape moved once already (docs vs build); wrap the rewrite defensively and
  no-op if the marker is missing rather than corrupting the prompt.
- **Presentation, not enforcement.** The `skill` tool still exists and the
  catalog still contains the hidden skill; a model that guesses an ID can
  still load it. If enforcement matters, pair the rewrite with an agent
  `skill` permission `deny` (§7.1) or `skill.transform` removal (§4.1).
- Per-turn, not persisted: the rewrite applies for the calls it runs on, which
  is exactly right for swappable config.

### 3.6 The watcher is location-scoped — VERIFIED (observed, not yet probed)

V2 watches config and instruction sources (`watcher subscribe` log lines for
`.opencode/skills`, `AGENTS.md`, even loadout skill directories) and hot-loads
them. This is the right mechanism for **"pick up a `loadouts sync` without
restarting the server"** — but it updates the location-wide catalog, so it
cannot vary config per session, and concurrent sessions at one location race
on whichever state loaded last. Use the watcher for live global updates; use
the context hook (§3.1, §3.5) or agent switching (§7.1) for per-session state.
Two different tools for two different scopes.

---

## 4. Catalog mutation mechanisms

These change what exists at a **location**. They are the reason the new
runtime no longer needs to render files to disk in order to change an agent's
capabilities.

### 4.1 `skill.transform` — dynamic skills — VERIFIED

This overturns V1's `nativeSkillHotSwap: false`.

```ts
await ctx.skill.transform((draft) => {
  draft.add({
    id: "v2probe-skill",
    name: "v2probe-skill",
    description: "probe-injected skill, no file on disk",
    location: "/tmp/opencode/v2probe/virtual.md",   // need not exist
    content: "Body injected by a plugin transform, not read from disk.",
  })
  draft.update("review", (skill) => { skill.autoinvoke = true })
  draft.remove("legacy")
})
await ctx.skill.reload()   // replay transforms after external state changes
```

Proof: after injection, `ctx.skill.list()` reported **20** skills including
`v2probe-skill`, against 19 real ones on disk. The `location` file did not
exist, confirming `content` is authoritative and skills need not be
filesystem-backed.

`Skill.Info`: `id`, `name`, `location`, `content` required; `description`,
`slash`, `autoinvoke` optional.

Implication for loadouts: a runtime can present a loadout's skills **without
`loadouts sync` writing anything**, and remove them on deactivate. Rendering
to `~/.claude/skills` etc. remains necessary only for other tools.

Caveat: transforms are location-scoped and survive plugin reloads within a
process. During probing an injected skill remained in the catalog after the
`draft.add` call had been disabled — dispose registrations explicitly rather
than assuming a code change clears them.

### 4.2 Other transforms — DOCUMENTED

All follow the same `transform` / `reload` / `dispose` pattern:

| Context | Draft operations | Use for loadouts |
|---|---|---|
| `ctx.command.transform` | `add({ name, description, execute })` | Register `/loadouts` properly. Replaces V1's `config.command` mutation plus the `command.execute.before` interception hack, which threw a sentinel error to suppress output. |
| `ctx.agent.transform` | `list/get/update/remove/default(id)` | Publish a loadout's agents; set the default agent per loadout. |
| `ctx.tool.transform` | `add/update/remove` | Loadout-provided tools. Per-call removal belongs in the context hook instead. |
| `ctx.mcp.transform` | `set/update/remove`, `disabled` | Enable a loadout's MCP servers (e.g. `websearch`) without editing config. |
| `ctx.reference.transform` | `add(name, source)` | Attach a loadout's reference roots (e.g. the Shorehouse vault). |
| `ctx.catalog.transform` | provider/model update, `model.default.set` | Loadout-specific default models. |
| `ctx.websearch.transform` | `add`, `default.set(id \| false)` | Swap or disable search per loadout. |

Two properties worth designing around:

- **Transforms compose in registration order** and are replayed on `reload()`,
  so later plugins observe earlier plugins' output. A loadout runtime should
  register one transform per artifact kind and re-run `reload()` on switch,
  rather than mutating shared state directly.
- **Disposal reveals what it overrode.** `registration.dispose()` rebuilds
  from remaining transforms, which gives clean deactivation semantics for free.

### 4.3 Command registration — DOCUMENTED

```ts
await ctx.command.transform((draft) => {
  draft.add({
    name: "loadouts",
    description: "Manage session-local loadouts",
    execute: async ({ sessionID, prompt, delivery }) => {
      // parse prompt.text, mutate runtime state for this sessionID
    },
  })
})
```

The executor receives `sessionID`, so a slash command is naturally
session-scoped — exactly what `/loadouts activate x` needs, without the V1
trick of throwing `LoadoutsRuntimeCommandHandledError` to swallow output.

---

## 5. State, transport, and UI

### 5.1 `ctx.storage` — durable plugin state — VERIFIED

```ts
await ctx.storage.set("session/" + sessionID, { names, fingerprint, at })
const state = await ctx.storage.get("session/" + sessionID)
await ctx.storage.remove("session/" + sessionID)
const page = await ctx.storage.scan({ prefix: "session/", limit: 100 })
```

Probe confirmed a set/get round trip inside `setup`. This **replaces the whole
V1 persistence layer**: `runtimeStatePath()`, `runtimeEventPath()`, the
sha256-of-cwd keying, `readPersistedStates`, `persistRuntimeState`, and the
`.event.json` sidecar can all be deleted. Storage is JSON, plugin-scoped,
durable across restarts, and prefix-scannable — key by `sessionID` directly.

### 5.2 RPC — server ↔ TUI transport — DOCUMENTED

V1 had the TUI plugin read the server plugin's cache files off disk. V2 has a
typed channel instead.

```ts title="src/rpc.ts"
import { Rpc } from "@opencode-ai/plugin/rpc"
import { z } from "zod"

export const Loadouts = Rpc.define({
  id: "loadouts",
  methods: {
    status: { input: z.object({ sessionID: z.string() }),
              output: z.object({ names: z.array(z.string()), fingerprint: z.string() }) },
    activate: { input: z.object({ sessionID: z.string(), names: z.array(z.string()) }),
                output: z.object({ ok: z.boolean() }) },
  },
  events: { changed: { schema: z.object({ sessionID: z.string(), names: z.array(z.string()) }) } },
})
```

Server registers with `ctx.rpc.register(Loadouts, { … })`; the TUI plugin gets
a handle and subscribes to `changed` for live dashboard updates. Keep the
contract in its own browser-safe module and export it as `./rpc` so both sides
import it without loading the implementation.

Caveat: subscriptions are live-only with no replay, so the TUI must fetch
current state on mount rather than relying on having heard the event.

### 5.3 TUI plugin surface — VERIFIED (separately)

The CLI plugin is a **separate module** from the server plugin, imported from
`@opencode-ai/plugin/tui`, and resolved at runtime (no local install needed —
unlike server plugins, §2.2). It uses `Plugin.define({ id, setup })` too.

```tsx
return context.ui.slot({
  append: "sidebar.footer",
  render: () => <box border><text>Loadouts: base·meta</text></box>,
})
```

Available slots: `app`, `home.footer`, `prompt.footer`,
`prompt.footer.status`, `prompt.footer.file`, `session.composer.top`,
`sidebar.content`, `sidebar.footer`. Also available: `ui.dialog.*` (alert,
confirm, prompt, select, custom JSX), `ui.router.register` for full routes,
`ui.toast.show`, `keymap.layer` for palette/slash/key commands, and
`context.data.location.{skill,command,agent,reference,mcp}.{list,sync}` for
reading the catalog without server calls.

A working reference implementation of the sidebar pattern lives in Evatt's
dotfiles at `opencode/plugins/context-sidebar.tsx`, which renders live skill /
command / agent / reference / MCP counts plus active global and local loadouts.

Note the API generation split: older builds used `{ id, tui }` with
`api.slots.register` and `api.ui.dialog.replace`; current builds use
`Plugin.define` with `context.ui.slot`. Check which the target build accepts —
`toy-popup.tsx` in that repo is an example of the older, now-rejected shape.

### 5.4 Events — DOCUMENTED

```ts
const controller = new AbortController()
void (async () => {
  for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
    if (event.type === "session.updated") { /* … */ }
  }
})()
return () => controller.abort()
```

Useful for reacting to session creation (auto-apply a default loadout) or to
`loadouts sync` completing. The TUI side has `context.data.on(type, cb)` and
`context.data.listen(cb)`.

---

## 6. Recommended architecture

### 6.1 Shape

Three modules, one package:

```
src/rpc.ts     Rpc.define contract (browser-safe, exported as "./rpc")
src/index.ts   server plugin: state, injection, command      → exports "."
src/tui.tsx    CLI plugin: dashboard, slot, keybinds         → exports "./tui"
```

Publishing as a package (rather than loose files in `.opencode/plugins/`)
solves the import-resolution problem in §2.2 and lets `./tui` load
automatically alongside the server plugin.

### 6.2 Core state model

One in-memory map mirrored to `ctx.storage`, keyed by session:

```ts
type SessionRuntime = {
  names: string[]          // active loadout names for THIS session
  scope: "local" | "global"
  bundle: RuntimeBundle    // from `loadouts runtime <names> --tool opencode --json`
  systemBlock: string      // rendered once at activation, not per turn
  fingerprint: string
  activatedAt: string
}

const runtimes = new Map<string, SessionRuntime>()
```

Register **one** long-lived context hook that reads the map — do not
register/dispose a hook per switch:

```ts
await ctx.session.hook("context", (event) => {
  const runtime = runtimes.get(event.sessionID)
  if (!runtime) return                                    // session uses global config
  event.system.push({ type: "text", text: runtime.systemBlock })   // tagged shape!
})
```

Mid-session switching is then just a map write: the next model call picks up
the new block, and `runtimes.delete(sessionID)` restores default behavior. No
reload, no restart, no file rendering.

### 6.3 Layer responsibilities

| Loadout artifact | Mechanism | Scope achieved |
|---|---|---|
| instructions, rules | context hook system block (§3.1); mirror to instruction entries (§3.2) for durability | true per-session |
| skills | `skill.transform` add/remove (§4.1) | location-wide; see §7.1 for per-session gating |
| agents | `agent.transform`, or `switchAgent` per session (§3.4) | selection is per-session |
| commands | `command.transform` (§4.3) | location-wide |
| MCP servers | `mcp.transform` with `disabled` (§4.2) | location-wide |
| references | `reference.transform` (§4.2) | location-wide |
| default model | `catalog.transform` `model.default.set`, or `switchModel` | selection is per-session |

The honest capability line for a V2 bundle header, replacing V1's:

```
capabilities: mode=v2, instructionInjection=true, ruleInjection=true,
              skillHotSwap=true(location), skillPerSession=false,
              agentSwitch=true, mcpToggle=true, persistence=plugin-storage
```

### 6.4 Command surface

```
/loadouts                     status for this session
/loadouts activate <names…>   set session runtime  [-l | -g]
/loadouts deactivate          clear session runtime
/loadouts list                available loadouts
/loadouts diff                session runtime vs global .state.json
```

Implement via `ctx.command.transform` (§4.3), which supplies `sessionID`
directly. Shell out to the existing CLI for compilation — `loadouts runtime
<names> --tool opencode --json` already emits the bundle, and reusing it keeps
one source of truth.

Given the verified results in §3.5 and §7.1 there are now **two** viable
`activate` designs, both without `skill.transform` bookkeeping:

**A. Same agent (recommended default).** Keep `build` (or whatever the session
selected); the runtime holds per-session state only:

1. context hook pushes the loadout's instruction delta (§3.1),
2. same hook rewrites the `<available_skills>` part to the session's skill
   set (§3.5),
3. `ctx.storage.set("session/" + sessionID, …)` as the record.

One hook, one map lookup, no agent juggling, works for every session including
subagents that pin a specific agent.

**B. Agents as loadouts.** Render each loadout as an agent and
`ctx.session.switchAgent(...)`. Structured and enforced (skill `deny` is real
permission filtering, not presentation), and it scopes tools/model/prompt in
one call — but it replaces the session's agent, which the user may not want,
and subagent selection interacts with it.

Hybrid: A for skills visibility + instruction delta, with an optional `deny`
ruleset via a per-loadout agent override when a loadout genuinely needs a
different tool/permission profile.

### 6.5 TUI dashboard

Sidebar slot showing global active set, local active set, and — the new part —
this session's runtime override with its fingerprint:

```
Loadouts
G base·meta·shorehouse+2
L none
S caveman·impeccable (a1b2c3d4)     ← session override
```

Pull `S` over RPC (§5.2), not by reading cache files. Fetch on mount, then
update from the `changed` event.

### 6.6 Bugs to fix in the CLI while you are here

- `loadouts runtime --tool opencode --system-block` with no names fails with
  `Loadout not found: evatt` — it mis-resolves the default/root name. Explicit
  names work. Same for `--json`.
- `loadouts runtime opencode` reads as *loadout named opencode*; the tool is
  `--tool`. Worth a clearer error.

---

## 7. Constraints and open questions

### 7.1 Skills CAN be hidden per session — via agent permissions — VERIFIED

`skill.transform` is location-wide, but the **advertisement is per-agent**.
Probed directly on beta-18707: a skill `probe-hidden` on disk appeared in the
`build` agent's `<available_skills>` system block (dumped via a context hook),
and was **absent** from a `restricted` agent's dump when that agent carried
`{ action: "skill", resource: "probe-hidden", effect: "deny" }`. The control
skill `probe-visible` appeared in both.

```
agent=build      parts=2 hasProbeHidden=true  hasProbeVisible=true
agent=restricted parts=2 hasProbeHidden=false hasProbeVisible=true
```

Agent definition used:

```md title=".opencode/agents/restricted.md"
---
description: Probe agent that denies probe-hidden
mode: primary
permissions:
  - action: skill
    resource: probe-hidden
    effect: deny
---
You are the restricted probe agent. Reply concisely.
```

So the advertised skill list is computed from the **session's selected agent**,
which means:

- Two sessions at the same location can have disjoint skill sets — switch the
  agent, and the advertisement changes on the next model call.
- Mapping a loadout onto an agent (its system prompt + skill permissions +
  model + tool permissions) gives true per-session scoping for skills,
  instructions, tools, and model in one move.
- `deny` hides from discovery; the docs also claim it rejects explicit
  loading, which remains unverified — `POST /api/session/{id}/skill` returned
  `SkillNotFoundError` on this build **even for an existing permitted skill**
  (control included), so that endpoint is anomalous on beta-18707 and the
  invocation-rejection path needs a different test.
- `opencode/autoinvoke: false` in frontmatter is the other hiding lever, but
  it is per-skill, not per-agent, and not runtime-mutable without
  `skill.transform`.

Design consequence: agents are **one** per-session scoping primitive —
verified, structured, and enforced — but not the only one. Rewriting the
advertisement part (§3.5) achieves per-session skill *visibility* with the
session's existing agent, which is usually what a loadout switch wants.
Rule of thumb: use §3.5 when the loadout changes what the model *sees*; use
agent permissions/switching when it changes what the model is *allowed* to
do. See §6.4 for both designs.

### 7.2 Prompt cache invalidation

The injected system block sits in the cached prefix. Changing it mid-session
invalidates the provider's prompt cache and forces a full re-read of the
conversation on the next turn — real money on long sessions. Mitigations:
render the block once at activation (not per turn), keep key order stable, and
warn in `/loadouts activate` output that switching costs a cache miss.

### 7.3 Compaction

The context hook does not run for compaction requests, so the injected block is
absent while summarizing — the summary will not describe the active loadout.
It reappears on the next normal turn. Whether an active loadout should survive
compaction *semantically* (e.g. re-announced via `session.synthetic`) is a
design decision.

### 7.4 Instruction entry size

`PUT` can return 413. The limit was not measured; measure it before routing
full instruction bodies through §3.2, and chunk by key or fall back to the
context hook.

### 7.5 Interaction with `loadouts sync`

A session runtime and the globally synced set can disagree. The rendered
`AGENTS.md` is already in the prompt, so injecting the same instructions again
double-counts tokens and may conflict. The runtime should diff against
`<root>/.state.json` (`{ active, mode, appliedAt, entries }`) and inject only
the delta, or explicitly declare an override in the block.

### 7.6 Verified / unverified summary

| Mechanism | Status |
|---|---|
| Object export `{ id, setup }` loads; function export fails | VERIFIED |
| `session.hook("context")` fires per session with system/messages/tools | VERIFIED |
| System part requires `{ type: "text", text }` | VERIFIED |
| `skill.transform` injects a skill visible in `skill.list()` | VERIFIED |
| `ctx.storage` set/get round trip | VERIFIED |
| Instruction entries are per-session isolated | VERIFIED |
| Location eviction endpoint is unreliable | VERIFIED |
| `session.hook("prompt")` skill/file attachment | DOCUMENTED |
| `POST /session/{id}/skill` activation semantics | BROKEN on beta-18707 — `SkillNotFoundError` even for existing, permitted skills (control included) |
| RPC server ↔ TUI | DOCUMENTED |
| Per-agent skill `deny` hides the skill from the `<available_skills>` advertisement | **VERIFIED** (§7.1) |
| Context hook rewrites the `<available_skills>` system part per session (same agent) | **VERIFIED** (§3.5) |
| Instruction entry size limit | UNKNOWN — measure |

---

## 8. Repro recipes

### 8.1 Probe plugin

Create `<dir>/.opencode/plugins/probe/index.ts` with no imports (avoids §2.2),
append results to a file rather than `console.log` (plugin stdout does not
reliably reach `~/.local/share/opencode/log/opencode.log`):

```ts
import fs from "node:fs"
const log = (l: string) => { try { fs.appendFileSync("/tmp/opencode/probe.log", l + "\n") } catch {} }

export default {
  id: "probe",
  async setup(ctx: any) {
    log("keys=" + Object.keys(ctx).sort().join(","))
    await ctx.session.hook("context", (e: any) => {
      log(`context session=${e.sessionID} agent=${e.agent} tools=${Object.keys(e.tools).length}`)
    })
  },
}
```

Exercise it with a cheap turn:

```bash
cd <dir> && opencode2 run "reply with exactly: ok"
cat /tmp/opencode/probe.log
```

**Do not delete the log file between runs** while iterating — registrations
from earlier loads stay live and keep writing, and deleting mid-sequence
destroys the evidence that explains what you are seeing.

### 8.2 Inspecting live state

```bash
opencode2 api get /api/skill                       # catalog incl. injected skills
opencode2 api get /api/agent
opencode2 api get /api/session/active
opencode2 api get /api/session/<id>/context        # messages in the window
opencode2 api get /api/session/<id>/instructions/entries
opencode2 api get /api/debug/location              # loaded locations
opencode2 debug config                             # instruction/config SOURCES
curl -s https://opencode.ai/v2/openapi.json        # authoritative schemas
```

Note `opencode` (V1) and `opencode2` (V2) are different binaries; only
`opencode2` has `api`.

### 8.3 Bisecting a runtime failure

The `Schema validation failed` bug in §3.1 was isolated by:

1. Running the same prompt in a directory **without** the plugin → clean,
   proving the plugin was responsible.
2. Removing the injected skill while keeping the hook → still failed,
   exonerating `skill.transform`.
3. Changing only the system-part shape → clean, convicting the part shape.

Keep a no-plugin control directory around; it converts "something is broken"
into a one-command bisection.
