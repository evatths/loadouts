# Loadouts TUI Architecture

Status: **Design / RFC** (no implementation yet)
Author: design pass, June 2026

A plan for turning the loadouts TUI from a passive popup into a beautiful, ergonomic,
standalone dashboard — in the spirit of `lazygit`, `mason.nvim`, `lazy.nvim`, and a
Call-of-Duty "create-a-class" menu — that can also run **embedded at runtime inside
OpenCode and Pi**, while preserving the `/loadouts <cmd>` entry points.

---

## 1. Goals & non-goals

### Goals

- A genuinely interactive dashboard: browse loadouts, **activate/deactivate from a list**,
  inspect their artifacts ("slots"), preview diffs, fix drift — all keyboard-driven.
- **One stack, multiple hosts.** Maximize shared code across:
  - a standalone `loadouts tui` binary (any terminal),
  - embedded in **Pi** at runtime (most important use case),
  - embedded in **OpenCode** at runtime,
  - launched from Cursor / Claude Code terminals (standalone, not embedded).
- Keep the existing `/loadouts <cmd>` fast paths; add `/loadouts` (no args) → open dashboard.
- Immediate toggle + undo (lazy/mason feel), with an optional diff preview before applying.

### Non-goals (for v1)

- Replacing the CLI. The TUI is additive; `loadouts <cmd>` stays the source of truth.
- A GUI/webview for Cursor. Cursor is Electron/VS Code and has no terminal-TUI surface;
  it gets the standalone binary in its integrated terminal.
- Native embedding inside Claude Code (no TUI plugin API); it gets the standalone binary.

---

## 2. The hard constraint: three incompatible renderers

Each host that can *embed* UI uses a different, mutually incompatible rendering model:

| Host        | Renderer                         | Component model                                   |
| ----------- | -------------------------------- | ------------------------------------------------- |
| **Pi**      | `@earendil-works/pi-tui`         | Imperative classes: `render(width): string[]`, `handleInput(data)` |
| **OpenCode**| `@opentui/solid`                 | JSX + Solid reactivity: `<box>`, `<text>`         |
| Standalone  | (free choice)                    | —                                                 |

There is **no shared JSX runtime** between Pi's `pi-tui` and OpenCode's `@opentui/solid`.
A single component tree cannot natively render in both. (An earlier assumption that Pi is
Ink-based was incorrect; the conclusion is the same — its renderer is incompatible with
`@opentui/solid`.)

### Decision: `pi-tui` is the primary substrate; OpenCode gets a thin secondary skin

`@earendil-works/pi-tui` is a **standalone, npm-publishable** terminal UI library
(`new TUI(new ProcessTerminal())`), with built-in `SelectList`, `SettingsList`, `Box`,
`Text`, `Markdown`, overlays, theming, and key handling. Therefore:

- **Standalone `loadouts tui`** → built on `pi-tui`.
- **Pi embedded** → same `pi-tui` components mounted via `ctx.ui.custom(...)`.
- → Standalone and Pi share the rendering skin **1:1** (covers the priority use case).
- **OpenCode embedded** → a separate, thin `@opentui/solid` skin.

Both skins are **dumb projections** of one shared, headless view-model (below), so the
OpenCode skin stays small and no business logic is duplicated.

> If a single renderer across all hosts ever becomes a hard requirement, the fallback is to
> launch the standalone `pi-tui` binary from OpenCode instead of embedding — but native
> embedding via the thin `@opentui/solid` skin is preferred for UX.

---

## 3. Layered architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ CORE  (src/tui/core/)  — framework-agnostic, zero UI deps             │
│  • data: read loadout/active/drift state (via `loadouts --json`        │
│           or direct calls into src/core)                               │
│  • actions: activate / deactivate / sync / clear / diff               │
│             (wrap render-engine.applyTargetSet, planRender, doctor)    │
│  • reducer: Model + Intent -> Model        (Elm-style state machine)   │
│  • view:    Model -> ViewSpec              (declarative render spec)   │
│  Pure & snapshot-testable. No terminal, no host APIs.                  │
└───────────────┬───────────────────────────────────────────┬──────────┘
                │ ViewSpec (data)        Intent (data)        │
        ┌───────▼─────────┐                          ┌────────▼─────────┐
        │ SKIN: pi-tui    │                          │ SKIN: opentui    │
        │ ViewSpec→pi-tui │                          │ ViewSpec→<box>   │
        │ keys→Intent     │                          │ keymap→Intent    │
        └───┬─────────┬───┘                          └────────┬─────────┘
            │         │                                       │
   ┌────────▼──┐  ┌───▼──────────┐                   ┌────────▼─────────┐
   │ HOST:     │  │ HOST: Pi     │                   │ HOST: OpenCode   │
   │ standalone│  │ extension    │                   │ tui plugin +     │
   │ ProcessTUI│  │ (command +   │                   │ server plugin    │
   │ + fs state│  │ inject + ui) │                   │ (route + inject) │
   └───────────┘  └──────────────┘                   └──────────────────┘
```

Three layers:

1. **Core** — all logic and state. Shared everywhere. (TEA: `Model`, `Intent`, `update`, `view`.)
2. **Skin** — translate `ViewSpec` → native widgets, and native key input → `Intent`. Two skins.
3. **Host adapter** — mount the skin, register `/loadouts`, perform runtime injection. Three adapters.

---

## 4. Proposed module layout

```
src/tui/
  core/
    model.ts          # Model (state) + initial state
    intent.ts         # Intent union (all user actions, host-agnostic)
    update.ts         # (Model, Intent) => Model            [pure]
    view.ts           # Model => ViewSpec                   [pure]
    viewspec.ts       # ViewSpec types (rows, panes, footer, overlay, style tokens)
    data.ts           # DashboardData provider (reads loadout/active/drift state)
    actions.ts        # async ops: activate/deactivate/sync/clear/diff (effects)
    theme.ts          # ThemeTokens (abstract palette) + mapping helpers
    keymap.ts         # abstract key->Intent table (single source for help overlay)
  skins/
    pi-tui/
      render.ts       # ViewSpec => pi-tui Container/SelectList/Box/Text
      input.ts        # pi-tui key data => Intent
      theme.ts        # ThemeTokens => pi-tui theme.fg/bg callbacks
    opentui/
      Dashboard.tsx   # ViewSpec => <box>/<text> (Solid)
      input.ts        # opentui keymap layer => Intent
      theme.ts        # ThemeTokens => api.theme.current
  hosts/
    standalone.ts     # `loadouts tui` entry: ProcessTerminal + pi-tui skin
    pi/
      extension.ts    # default ExtensionAPI factory: command + inject + mount
      inject.ts       # before_agent_start system-prompt block
    opencode/
      route.ts        # api.route.register("loadouts") mounting opentui skin
      (reuses src/integrations/opencode-runtime/* for command + injection)
```

The existing `src/integrations/opencode-runtime/` (bridge, command parser, state,
system-block injection) is reused as-is by the OpenCode host; the new TUI route is layered
on top. A parallel `src/integrations/pi-runtime/` (or the `hosts/pi/` module above) provides
the Pi equivalent.

---

## 5. The view-model (headless core)

The core is an Elm-style state machine. The renderers never see loadouts domain types — only
`ViewSpec` and `Intent`.

### 5.1 Model (state)

```ts
type Section = "active" | "available" | "issues";
type ActivationMode = "filesystem" | "runtime"; // fs = persistent; runtime = this session

interface LoadoutRow {
  name: string;
  scope: "global" | "project";
  description?: string;
  status: "active" | "available" | "drift" | "broken";
  activation: ActivationMode | null;     // how it is currently active, if at all
  counts: { rules: number; skills: number; instructions: number; extensions: number };
  tools: string[];                        // tools this loadout targets
  issue?: string;                         // e.g. "missing include: foo"
}

interface Model {
  rows: LoadoutRow[];
  sections: Record<Section, string[]>;    // ordered row names per section
  cursor: { section: Section; index: number };
  filter: { text: string; scope?: "global" | "project"; tool?: string };
  mode: ActivationMode;                   // default target for toggles (host-defaulted)
  staged?: Set<string>;                   // optional plan-mode (defer apply)
  undo?: UndoSnapshot;                    // last applied set, for `u`
  detail?: DetailModel;                   // expanded artifact view of cursor row
  overlay?: "help" | "diff" | "confirm" | null;
  busy?: { label: string } | null;        // async op in flight
  lastResult?: { text: string; variant: "info" | "success" | "error" };
}
```

### 5.2 Intent (every user action, host-agnostic)

```ts
type Intent =
  | { t: "move"; delta: number }
  | { t: "section"; dir: 1 | -1 }
  | { t: "toggle" }                       // space: activate/deactivate cursor row
  | { t: "activate" } | { t: "deactivate" }
  | { t: "sync" } | { t: "clear" }
  | { t: "diffPreview" }
  | { t: "edit" }                         // open YAML in $EDITOR (host-dependent)
  | { t: "enter" }                        // drill into detail / confirm
  | { t: "filterInput"; text: string }
  | { t: "cycleScope" } | { t: "cycleTool" } | { t: "cycleMode" }
  | { t: "undo" } | { t: "refresh" }
  | { t: "openHelp" } | { t: "closeOverlay" }
  | { t: "quit" };
```

### 5.3 ViewSpec (declarative render output — the contract with skins)

```ts
type StyleToken =
  | "text" | "muted" | "dim" | "accent"
  | "success" | "error" | "warning" | "border";

interface SpecSpan { text: string; style?: StyleToken }
interface SpecRow {
  id: string;
  glyph: { char: string; style: StyleToken };  // ✓ + ~ - ! ? — (visual-language.md)
  spans: SpecSpan[];                            // pre-formatted, renderer pads/truncates
  selected: boolean;
}
interface SpecPane { title: string; rows: SpecRow[] }       // list panes (sections)
interface SpecDetail { title: string; blocks: SpecSpan[][] } // detail pane lines
interface SpecFooter {
  equipped: SpecSpan[];                          // the COD "EQUIPPED:" status bar
  keys: { key: string; label: string }[];        // hint bar (from keymap.ts)
}
interface ViewSpec {
  panes: SpecPane[];
  detail?: SpecDetail;
  footer: SpecFooter;
  overlay?: { kind: "help" | "diff" | "confirm"; title: string; lines: SpecSpan[][] };
}
```

A skin's entire job: render `ViewSpec` (mapping `StyleToken` → host colors, padding/truncating
spans to width) and map native key events → `Intent`. Both skins are interpreters of this spec,
so they stay thin and visually consistent. `ViewSpec` is snapshot-testable with zero terminal.

### 5.4 Effects / actions

`update` stays pure; async work returns an effect descriptor the host runs, then feeds the
result back as an `Intent`-like message:

```ts
type Effect =
  | { t: "apply"; targetSet: string[]; mode: ActivationMode }  // activate/deactivate/sync
  | { t: "clear"; mode: ActivationMode }
  | { t: "plan"; targetSet: string[] }                          // diff preview
  | { t: "reload" }                                             // re-read data
  | { t: "editFile"; path: string };
```

`actions.ts` implements effects:
- **filesystem mode** → call `render-engine.applyTargetSet` / `planRender` / `removeManaged`
  (or shell out to `loadouts <cmd> --json`).
- **runtime mode** → call the host's injection adapter (Pi `before_agent_start`,
  OpenCode `experimental.chat.system.transform`) via the existing runtime bridge.

---

## 6. Host adapters

Each host implements a small `HostContext` and mounts a skin.

```ts
interface HostContext {
  theme(): ThemeTokens;                 // host palette mapped into abstract tokens
  requestRender(): void;                // ask host to re-render the mounted skin
  exit(): void;                         // close dashboard (route/overlay/process)
  openEditor(path: string): Promise<void>;
  data: DashboardData;                  // read state (loadouts, active set, drift)
  runtime?: RuntimeInjector;            // present only where runtime activation exists
}

interface RuntimeInjector {            // session-scoped activation
  activate(names: string[], scope: "local" | "global"): Promise<void>;
  deactivate(): Promise<void>;
  status(): RuntimeStatus;
}
```

### 6.1 Pi host (`@earendil-works/pi-coding-agent` extension)

Pi's extension API is a first-class fit — arguably the best host of the three:

| Need                         | Pi API                                                            |
| ---------------------------- | ---------------------------------------------------------------- |
| `/loadouts` command          | `pi.registerCommand("loadouts", { handler })`                    |
| `/loadouts` (no args) → open | handler calls `ctx.ui.custom(mountDashboard, { overlay: true })` |
| Keyboard dashboard           | `ctx.ui.custom(component)` with `render/handleInput/invalidate`  |
| Runtime injection            | `pi.on("before_agent_start", … => ({ systemPrompt }))`           |
| Resource discovery (skills)  | `pi.on("resources_discover", … => ({ skillPaths, promptPaths, themePaths }))` |
| EQUIPPED status bar          | `ctx.ui.setStatus("loadouts", …)` / `ctx.ui.setWidget(...)`      |
| Hotkey to open               | `pi.registerShortcut("ctrl+l", …)`                               |
| Toasts                       | `ctx.ui.notify(message, variant)`                                |
| Hot reload                   | extensions in `~/.pi/agent/extensions/` reload via `/reload`     |

Distribution: ship a bundled loadout `pi-runtime` whose `include` renders a Pi extension to
`{base}/extensions/loadouts-runtime.ts` (Pi `extension` kind already exists in
`src/builtins/tools/pi.ts:20`). The extension bundles the `core` + `pi-tui` skin.

Notable upside: `resources_discover` lets Pi natively pick up loadout-contributed
skills/prompts/themes at runtime — a cleaner injection path than OpenCode's system-block.

### 6.2 OpenCode host (existing plugin, upgraded)

Reuse `src/integrations/opencode-runtime/` (command parsing, session state, system-block
injection). Add a TUI route:

| Need                  | OpenCode API                                              |
| --------------------- | -------------------------------------------------------- |
| `/loadouts` command   | already registered (`plugin.ts:271`)                     |
| `/loadouts` → open    | TUI plugin registers `api.route.register("loadouts")` and a keymap layer; server plugin signals "open" via the existing cache-file event channel |
| Dashboard             | `@opentui/solid` skin in `api.route` (full screen)        |
| Runtime injection     | `experimental.chat.system.transform` (`plugin.ts:318`)    |
| EQUIPPED bar          | `api.slots.register` (e.g. `session_prompt_right`)        |
| Theme                 | `api.theme.current`                                       |

The current passive popup (`bundled/opencode/plugins/loadouts-runtime-tui.tsx`) is replaced by
a real route; the toast/event channel remains for non-interactive `/loadouts <cmd>` feedback.

### 6.3 Standalone host (`loadouts tui`)

- New CLI command (`src/cli/commands/tui.ts`) wired into `src/cli/index.ts`; optionally make
  bare `loadouts` default to it.
- Mounts the `pi-tui` skin against `new TUI(new ProcessTerminal())`.
- Only **filesystem** activation (no session to inject into) — `mode` is fixed to `filesystem`,
  `runtime` toggle hidden.
- This binary is also the integration for Cursor / Claude Code (run it in their terminal).

---

## 7. The `--json` CLI contract (prerequisite)

The TUI must consume structured data, not scrape formatted tables. Add a stable
`--json` output mode to the read/▶︎mutate commands the dashboard needs. Proposed shapes:

```jsonc
// loadouts list --json
{ "loadouts": [ { "name": "backend-py", "scope": "project", "description": "...",
  "status": "active", "tools": ["claude-code","cursor","opencode"],
  "counts": { "rules": 3, "skills": 0, "instructions": 1, "extensions": 0 } } ] }

// loadouts status --json   (active set + drift)
{ "active": ["backend-py","review-mode"], "drift": [ { "name": "data-eng",
  "kind": "rule", "path": ".cursor/rules/x.mdc", "reason": "modified" } ] }

// loadouts info <name> --json   (artifact-level "slots")
{ "name": "backend-py", "items": [ { "kind": "rule", "relativePath": "py-style.md",
  "tools": ["claude-code","cursor"] } ] }

// loadouts diff <names...> --json   (planRender output)
{ "changes": [ { "tool": "cursor", "path": ".cursor/rules/x.mdc", "op": "overwrite" } ] }
```

Mutations (`activate`, `deactivate`, `sync`, `clear`) should accept `--json` and emit a
result envelope `{ ok, applied, removed, shadowed, error? }`. Standalone uses these (or calls
`src/core` directly); embedded hosts may prefer direct `src/core` calls to avoid spawning.

---

## 8. `/loadouts` entry-point integration

Symmetric model across surfaces:

| Input                         | Behavior                                              |
| ----------------------------- | ----------------------------------------------------- |
| `/loadouts` (no args)         | **Open the interactive dashboard** (route/overlay)    |
| `/loadouts activate x [-l/-g]`| Fast non-interactive op (current behavior, unchanged) |
| `/loadouts status \| list \| info \| ...` | Fast path; result via toast/notify           |
| `loadouts` (terminal)         | Open standalone dashboard (or keep help; configurable)|
| `loadouts activate x`         | CLI op (unchanged)                                    |

The slash parser (`src/integrations/opencode-runtime/command.ts`) already maps aliases and
scope flags; extend it so an empty action opens the dashboard instead of printing help. Pi's
`registerCommand("loadouts")` handler mirrors the same parse → dispatch.

---

## 9. UX specification

### 9.1 Layout (master-detail, mason-style)

```
┌─ LOADOUTS ────────────────────────────────────┬─ backend-py ───────────────────┐
│ ▸ Active (2)                                   │ scope: project · active · synced│
│   ✓ backend-py     project  3 rules  [fs]      │ "Python backend conventions"    │
│   ✓ review-mode    global   1 skill  [session] │                                 │
│ ▸ Available (8)                                │ Artifacts (slots)               │
│   - frontend-react project                     │  rule   py-style     → cc cu    │
│   ~ data-eng       project  DRIFT              │  skill  pytest-run   → cc op    │
│   - security-audit global                      │  instr  onboarding   → all      │
│ ▸ Issues (1)                                   │                                 │
│   ! broken-loadout missing include             │ Renders to                      │
│                                                │  claude-code  cursor  opencode  │
│                                                │     ✓           +        ✓      │
└────────────────────────────────────────────────┴────────────────────────────────┘
 EQUIPPED: backend-py + review-mode → cc, cursor, opencode · in sync
 [space] toggle  [a]ctivate [d]eactivate  [s]ync  [D]iff  [e]dit  [/]find  [?]help
```

- Sections **Active / Available / Issues**; glyphs reuse `docs/visual-language.md`
  (`✓ + ~ - ! ? —`).
- `[fs]` vs `[session]` badge makes filesystem vs runtime activation legible.
- Detail pane shows a loadout's artifacts as **"slots"** (COD create-a-class), each with its
  target tools, plus a per-tool render-status row.
- The **EQUIPPED** bar is the COD flourish: current set, render targets, sync state. Injected
  counts can reuse the logic in `runtimeActivationToast` (`opencode-runtime/plugin.ts:154`).

### 9.2 Keymap (single source → drives the `?` overlay)

| Key            | Intent                                  |
| -------------- | --------------------------------------- |
| `j/k` `↑/↓`    | move                                    |
| `tab`/`S-tab`  | cycle section                           |
| `space`        | toggle activate/deactivate (immediate)  |
| `a` / `d`      | explicit activate / deactivate          |
| `s` / `x`      | sync / clear all                        |
| `enter`        | drill into artifacts / confirm          |
| `D`            | diff preview overlay (`planRender`)     |
| `e`            | edit YAML in `$EDITOR`                  |
| `m`            | cycle activation mode (fs ↔ session)   |
| `g` / `t`      | cycle scope / tool filter               |
| `/`            | fuzzy filter                            |
| `u` / `r`      | undo / refresh                          |
| `?` / `q`      | help / quit                             |

**Apply model:** immediate toggle + `u` undo (chosen). `staged`/plan-mode is reserved in the
`Model` for a later opt-in, and `D` gives a pre-apply diff for the cautious path.

---

## 10. Runtime vs filesystem activation in the UI

The dashboard surfaces both existing activation models (see `src/core/runtime.ts`):

- **Filesystem** (`render-engine.applyTargetSet`): persistent, writes files, tracked in
  `.state.json`. Available in every host (and the only mode standalone offers).
- **Runtime** (session-injected): ephemeral, this-session-only.
  - OpenCode: `experimental.chat.system.transform` (built).
  - Pi: `before_agent_start` `{ systemPrompt }` + `resources_discover` (to build).

`mode` defaults per host (embedded → `runtime`, standalone → `filesystem`), is shown in the
EQUIPPED bar, and is toggled with `m`. Rows display which mode they're active under.

---

## 11. Packaging

Bundled loadouts (in `bundled/loadouts/`) distribute the host integrations, matching the
existing `opencode-runtime.yaml` pattern:

- `opencode-runtime.yaml` — existing; add the route-based TUI plugin alongside the server plugin.
- `pi-runtime.yaml` (new) — `include:` a Pi extension rendered to
  `~/.pi/agent/extensions/loadouts-runtime.ts` (the `extension` kind in `pi.ts`).

The shared `core` + skins are compiled/bundled into each host's artifact (Pi loads `.ts`
extensions via jiti; OpenCode loads the `.tsx` plugin). The standalone skin ships in the main
`loadouts` binary.

---

## 12. Testing strategy

- **Core (pure):** unit-test `update` (Intent → Model) and snapshot-test `view`
  (Model → ViewSpec). No terminal required. This is where most behavior is verified.
- **Skins:** `pi-tui` ships a `VirtualTerminal` (`@xterm/headless`) for headless rendering
  assertions; OpenCode skin tested via tmux capture per `opencode-tui-plugins` skill.
- **Hosts:** integration-test command parsing + injection (existing
  `opencode-runtime/*.test.ts` pattern); add a Pi equivalent.
- **E2E:** reuse the `runtime-injection-e2e` approach for the runtime activation path.

---

## 13. Phased plan

1. **Core + `--json`.** Build `src/tui/core/` (Model/Intent/update/view/ViewSpec/data/actions)
   and add `--json` to `list/status/info/diff` + mutation envelopes. Fully unit-tested,
   no UI. *Largest, highest-leverage step.*
2. **Standalone + `pi-tui` skin.** Ship `loadouts tui` on `pi-tui`. Filesystem mode only.
   This proves the whole stack end-to-end in any terminal.
3. **Pi host.** `pi-runtime` extension: `/loadouts`, `ctx.ui.custom` dashboard (reusing the
   skin from step 2), `before_agent_start` injection, `resources_discover`, EQUIPPED status.
   *The priority use case.*
4. **OpenCode host.** `@opentui/solid` skin + `api.route.register`; reuse existing
   command/injection plumbing; replace the passive popup with the route.
5. **Polish.** Fuzzy search, multi-select bulk ops, drift one-key fix, diff overlay,
   empty/first-run CTA, themes, `?` help generation.

---

## 14. Open questions / risks

- **Bundle size / load time** of embedding `core` + `pi-tui` inside a Pi extension and
  `core` + `@opentui/solid` inside an OpenCode plugin — measure; consider prebuilding.
- **Direct-core vs shell-out** for embedded hosts: calling `src/core` directly avoids spawn
  cost but couples the plugin to internal APIs; `--json` shell-out is cleaner but slower.
  Recommendation: direct-core for embedded, `--json` for standalone/tests.
- **Pi runtime injection fidelity:** confirm `before_agent_start` + `resources_discover` fully
  cover instructions/rules/skills the way `runtime.ts` expects for `pi` (`native-runtime`).
- **Doc drift:** `src/builtins/tools/pi.ts` omits a native `rule` target, but some top-level
  docs still show Pi rule paths — reconcile so the UI's tool/render columns are accurate.
- **Theme parity:** define `ThemeTokens` so both skins look consistent; respect `NO_COLOR`
  standalone.
```
