# OpenCode V2 probes — P3/P4/P5/P6 source evidence

Status: **source-verified pass** (2026-09-14). Answers the open probes in
`plans/OPENCODE-V2-RUNTIME.md` §4. Every claim below was read out of exact
sources; nothing is inferred from docs or memory. No live TUI/service was
started or modified.

Version sources used (in preference order — the shared scratch under
`/private/var/folders/hh/y90cz08d14j4nl2l8nncn7bh0000gn/T/opencode` had several
ghosted/symlinked `node_modules` dirs, so tarball and git-tag sources were
preferred over loose scratch files):

- **opencode source, tag `v2.0.3`** — fetched raw from
  `github.com/sst/opencode` (redirects to `anomalyco/opencode`); core files
  also present as extracts in scratch `src/` (names prefixed
  `core_*` = `packages/core/src/...`).
- **`@opencode/plugin@2.0.3`** — extracted tarball, scratch
  `plugin-2.0.3/package/dist/` (its `package.json` pins deps:
  `@opencode/{ai,client,protocol,schema,util}@2.0.3`, peer
  `@opentui/{core,solid} >=0.5.10`, `solid-js >=1.9.0`).
- **`@opencode/util@2.0.3`**, **`@opencode/ai@2.0.3`** — extracted tarballs
  (scratch `util203-*`, `ai-2.0.3/package`).
- **`@opentui/solid@0.5.11` + `@opentui/core@0.5.11`** — `npm pack`ed into
  scratch `p3-tui/` this session.
- **Version correction for the plan:** opencode v2.0.3's root `package.json`
  catalog pins `@opentui/{core,keymap,solid} = 0.5.10` and `solid-js =
  1.9.15` — **not** `@opentui/*@0.5.11` as the plan header states. 0.5.11 is
  what `@opencode/plugin@2.0.3`'s peer range permits, but upstream v2.0.3
  builds and ships against 0.5.10.

Throughout: **SV** = source verified (file+line read); **LT** = live tested
(this pass did none); **LT\*** = live-tested in a prior session (cited, not
re-run).

---

## P4 — Global `AGENTS.md` discovery candidates

**Question:** does V2 read `~/.config/opencode/AGENTS.md` or `~/AGENTS.md` as
the global instruction file?

**Answer (SV):** Global scope reads **only `~/.config/opencode/AGENTS.md`**
(XDG config dir; `OPENCODE_CONFIG_DIR` honored). `~/AGENTS.md` is **not** a
global candidate — but it is *not* dead either: it is picked up by the
**project ancestor walk** for any session whose location sits under `$HOME`.

Evidence, `packages/core/src/config/plugin/instruction.ts` (scratch
`src/core_config_plugin_instruction.ts`):

- L34–37: `start = location.directory` (session cwd ref), `root =
  location.project.directory`, `home = global.home`, and
  `globalFile = join(global.config, "AGENTS.md")`.
- L36: `const stop = FSUtil.contains(home, start) ? home : root` — the
  ancestor walk extends to `$HOME` whenever the location is under it.
- L43–50: candidates = `[globalFile]` (only when `discovery.global`, L44) plus
  `ancestorDirectories(start, stop).map(dir => join(dir, "AGENTS.md"))`
  (L46–48). `$HOME` itself is the last element of that walk, so `~/AGENTS.md`
  is a watched candidate for under-home locations.
- L62–66: `globalSource` reads **only** `globalFile`.
- L68–75: `projectSource` = `fs.up({ targets: ["AGENTS.md"], start, stop })`.
- `fs.up` is inclusive of `stop` (`@opencode/util@2.0.3`
  `dist/fs-util.js` L94–114: target checked at `current` before the
  `stop === current` break), and `FSUtil.contains` is inclusive
  (`dist/fs-util.js` L206–209) — so a project rooted at `~` still checks
  `~/AGENTS.md`.
- Defaults: `project` and `global` discovery are both on unless configured off
  (`src/core_instruction-discovery.ts` L99–100: `options?.project !== false`,
  `options?.global !== false`).
- `global.config` = `<XDG_CONFIG_HOME || ~/.config>/opencode`
  (`@opencode/util@2.0.3` `dist/global-roots.js` L6–9 + `roots()`), overridden
  by `OPENCODE_CONFIG_DIR` (`src/util_global.ts` L79).

**Consequence for Loadouts:** the P4 fear is already neutralized in current
`src/builtins/tools/opencode.ts` — L9 sets the tool base to
`~/.config/opencode` and L32–36 render global instructions to
`{base}/AGENTS.md` with a comment citing exactly this core file. The plan §4's
premise ("renders global instructions to `{home}/AGENTS.md`") is stale for the
current source. Remaining nuance worth a comment in the tool spec: a file at
`~/AGENTS.md` would *also* be discovered — as **project-scope** instructions —
for every project under `$HOME`, so we must never render global instructions
there.

---

## P5 — Is `ui.router.current()` reactive in Solid computations?

**Question:** can the dashboard/EQUIPPED bar track session switches via
`ui.router.current()`?

**Answer (SV, not live-tested):** **Yes — at property granularity.**
`current()` returns the underlying `solid-js/store` proxy. It is reactive when
its *properties* (`type`, `sessionID`, `name`, `data`) are read inside a
computation; the call itself reads no signal, so `const r =
ui.router.current()` followed by property reads later still tracks, but
treating the returned object as an opaque "snapshot" (e.g. storing it and
comparing by reference) will not update.

Evidence:

- `packages/tui/src/context/route.tsx` (v2.0.3): L29–35 the route context is
  `createStore<Route>(...)`; L37–43 `navigate` = `setStore(reconcile(route))`
  (fine-grained per-property notifications, including key removal when
  switching `session` → `plugin`); L38–39 `get data() { return store }`.
- `packages/tui/src/plugin/api.tsx` (v2.0.3, also scratch
  `p3p5p6-src/api.tsx`): L59 `route: useRoute()` in the plugin host; L176–178
  `current() { return host.route.data }` — a direct store hand-off, no
  signal/memo wrapper.
- The host app itself relies on exactly this pattern: `packages/tui/src/app.tsx`
  (v2.0.3) reads `route.data.type` / `route.data.sessionID` inside
  `createEffect`s (terminal-title effect, session-environment effect), so
  property-level tracking is the intended contract.
- Published d.ts (`plugin-2.0.3/package/dist/tui/context.d.ts`): L399–403
  `router.current(): Route` carries **no** "Reactive when read in a Solid
  computation" doc comment — unlike `panel.current()` (L411–415) and
  `tabs.list()` (L420) which do. The doc-comment asymmetry is a trap; the
  implementation is reactive all the same. Worth a note in our plugin code.

---

## P3 — TUI loader: local plugin dir import host injection

**Question:** does a local plugin *dir* without `node_modules` resolve
`@opencode/plugin/tui` + `@opentui/solid` in the TUI?

**Answer (SV):** **Yes, on Bun** (the TUI runtime). The TUI host installs a
process-wide Bun loader plugin *before* any plugin source is imported, which
rewrites those bare specifiers to host-provided virtual modules. **On Node,
there is no injection** (plugins must be precompiled). The prior empirical
result that the **server** loader has no such injection for local dirs
(LT\*, prior session) stands unchanged — server and TUI have different
loaders.

Evidence chain:

1. **Host installs injection at startup** — `packages/tui/src/plugin/context.tsx`
   (v2.0.3) L24: `import "#runtime-plugin-support"`, mapped by
   `packages/tui/package.json` `imports` to
   `src/plugin/runtime-plugin-support.bun.ts` under the `bun` condition
   (default/`node` maps to `.node.ts`, which is a single comment: "Node loads
   precompiled plugins without it").
2. **What is injected** — `runtime-plugin-support.bun.ts` (scratch
   `p3p5p6-src/`, L1–8) calls `ensureRuntimePluginSupport({ additional: {
   "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin } } })`.
3. **Injection mechanism** — `@opentui/solid@0.5.11`
   `scripts/runtime-plugin-support-configure.js`: default injected modules =
   `@opentui/solid`, `@opentui/solid/components`, `@opentui/solid/jsx-runtime`,
   `@opentui/solid/jsx-dev-runtime`, `solid-js`, `solid-js/store` (plus core
   `@opentui/core` / `@opentui/core/testing`); then
   `registerBunPlugin(createRuntimePlugin({ core, additional: modules, rewrite }))`
   and `ensureSolidTransformPlugin({ moduleName:
   runtimeModuleIdForSpecifier("@opentui/solid"), resolvePath })`. The Node
   variant (`scripts/runtime-plugin-support.node.js`) throws
   `"@opentui/solid/runtime-plugin-support is Bun-only…"`.
4. **Rewrite semantics** — `@opentui/core@0.5.11` `dist/runtime-plugin.js`
   (header comment + L43/L68): matching imports are rewritten to virtual
   `opentui:runtime-module:<encodeURIComponent(specifier)>` ids; **non-`node_modules` source files
   (i.e. our plugin's files) get a dedicated rewrite loader immediately**;
   `node_modules` ESM is recursively prescanned and only rewritten when it
   transitively imports a runtime module. The configure-provided `resolvePath`
   maps any specifier present in the module map (including the additional
   `@opencode/plugin/tui`) to its virtual id and returns `null` for everything
   else (normal resolution).
5. **`solid-js/dist/solid.js` role** — three exact facts: (a) `@opentui/solid@0.5.11`
   `index.js` (package root) L103/205/210 etc. imports `solid-js/dist/solid.js`
   **directly** — the host's reactive runtime is pinned to the universal
   bundle, bypassing export conditions; (b) `scripts/solid-plugin.js`
   onLoad-swaps `node_modules/solid-js/dist/server.js` → `solid.js` (and
   `solid-js/store/dist/server.js` → `store.js`), so any node_modules dep in a
   plugin graph that resolves solid's server condition gets the same runtime;
   (c) `scripts/solid-transform.js` L20–28 exports
   `resolveNodeSolidRuntimeImport` mapping bare `solid-js` →
   `solid-js/dist/solid.js`, `solid-js/store` → `solid-js/store/dist/store.js`
   — exported helper; no caller found inside the two published tarballs. For
   **plugin source files**, bare `solid-js` does not go down any of these
   paths: it is in the virtual-module map (`defaultRuntimeModules`), so it
   resolves to the host's module instance, and babel `babel-preset-solid`
   compiles JSX with `moduleName` = the virtual `@opentui/solid` id,
   `generate: "universal"`.
6. **Local dir graph loading** — `packages/tui/src/plugin/discovery.ts`
   (v2.0.3) L22–49: `discoverPluginTargets` returns **directories only** under
   `<globalConfig>/plugins/` and `<project>/.opencode/plugins/`.
   `packages/tui/src/plugin/context.tsx` `resolvePlugin`: local targets →
   `sources.read(entrypoint)` → `@opencode/plugin@2.0.3` `dist/source.js`
   (`createPluginSources`: digest-cached, file-tracked) → `dist/source.bun.js`
   `prepareSource`: scans the local graph with `Bun.Transpiler.scan`
   (**skips `node_modules`**, tracks files for hot reload), then `load: () =>
   Host.load(entrypoint)`; `dist/host.js`: local dir entry resolution is
   **file-convention** — `tui` → `path.resolve(dir, "tui")`, `server` →
   `<dir>/server` or `<dir>/index`, `rpc` → `<dir>/rpc` (package.json
   `exports` only matter for named package targets); `load` = `importModule`
   → `@opencode/util@2.0.3` `dist/runtime/import.bun.js`: plain dynamic
   `import()` + `Bun.resolveSync` — i.e. the graph flows through Bun's native
   loader, where the plugins from steps 3–4 are registered. Single *file*
   local targets are skipped by the TUI reconcile and reach the TUI via the
   server's plugin list (`source.type === "local"` → `path.dirname`), which
   matches the plan's "single files are dropped by the loader" **V**.

**Conclusion for distribution path 1 (local dir, dotfiles):** viable for the
TUI entry without any `node_modules` — `@opencode/plugin/tui`,
`@opentui/solid`, and `solid-js` all resolve via host injection on Bun. The
dir needs `tui.{ts,tsx,js}` (+ optional `server.*`, `rpc.*`) at its root; a
`package.json` `exports` map is unnecessary for local dirs (it only affects
npm-package targets). Server entry of the same dir still hits the confirmed
missing-deps wall (LT\*) — a TUI-only dir plugin is safe; a dir whose server
entry imports unresolvable packages is not.

---

## P6 — `CacheHint` fields and semantics in `@opencode/ai`

**Question:** exact shape of `SystemPart.cache` and what it does downstream.

**Answer (SV):**

- **Shape** — `@opencode/ai@2.0.3` `dist/schema/options.d.ts` L135–140:
  `CacheHint = { type: "ephemeral" | "persistent"; ttlSeconds?: number }`.
  `dist/schema/messages.d.ts` L1–23: `systemPartSchema = { type: "text",
  text: string, cache?: CacheHint, metadata?: Record<string, unknown> }` with
  `SystemPart.make(text)` convenience. (`CachePolicy` at
  `options.d.ts` L141–155 — request-level `"auto" | "none" | {tools, system,
  messages, ttlSeconds}` — is a separate, per-request concept.)
- **Anthropic lowering** — `dist/protocols/anthropic-messages.js`:
  L335–341 documents a hard cap of **4 `cache_control` breakpoints per
  request** across `tools`+`system`+`messages`; beyond the cap markers are
  **counted (`breakpoints.dropped`) and silently dropped** (L346–351).
  L343–352: both hint types (`ephemeral` and `persistent`) lower to
  `cache_control: { type: "ephemeral" }`; `ttlBucket(ttlSeconds) === "1h"`
  adds `ttl: "1h"`, else the wire TTL is omitted (provider default 5m).
  System parts each get their own `cache_control` when present (L924–930).
- **TTL bucket** — `dist/protocols/utils/cache.js` L5:
  `ttlBucket = ttlSeconds !== undefined && ttlSeconds >= 3600 ? "1h" :
  undefined`. So `ttlSeconds >= 3600` → 1h bucket; anything else (including
  omitted) → default 5m. Same mapping used by openrouter
  (`dist/providers/openrouter.js` L8, L57) and bedrock
  (`dist/protocols/utils/bedrock-cache.js` L47).
- **OpenAI-family** — `dist/protocols/openai-chat.js` L293–294: within a
  message only the **last** cache-bearing part gets the breakpoint
  (`findLast`); system parts are marked individually when any system part
  carries a cache (L344–351).
- **`persistent` vs `ephemeral`:** no behavioral divergence found in any
  lowering path — every consumer gates on
  `type !== "ephemeral" && type !== "persistent"` and then uses only
  `ttlSeconds`. Treat `type` as an accepted-but-inert discriminator today.
- **Baseline:** opencode core sets **no** cache hints on its own
  instruction/context system parts (no `cache` usage in
  `packages/core/src/session/{context,instructions,instruction-entry}.ts` or
  `packages/core/src/instructions/index.ts` — instructions render as plain
  strings, `src/core_instructions_index.ts` L165–189). A `cache`-carrying part
  injected by our phase-3 context hook would therefore consume one of the 4
  breakpoints fresh. Practical guidance for the plan's "use `cache`" note:
  one hint on our single injected block is safe; never hint per-artifact
  (breakpoint cap), and `ttlSeconds: 3600` only makes sense for long sessions
  where the 1h Anthropic cache price is worth it.
