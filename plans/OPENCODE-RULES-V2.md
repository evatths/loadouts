# opencode-rules-v2 — V2-native rules plugin for OpenCode (+ loadouts integration)

Tier: **plan file, task briefs for /orchestrate.** It creates a new repo and has real design choices (how rules are delivered, how they're classified, how they get to the model). Supersedes the untracked `plans/FIX-OPENCODE-RULES-BUG.md`, which dropped the rule kind for opencode. Don't execute it.

## Intent

OpenCode V2 core never reads `.opencode/rules/`. We're building a small plugin, installed globally, that gives OpenCode the rule semantics Claude Code and Cursor share:

- always-on rules
- path-scoped rules
- agent-requested rules
- manual rules

Loadouts keeps rendering `rule` → `.opencode/rules/{stem}.md`, and this plugin is what makes those files real.

**Build vs adopt was decided.** `opencode-rules@2.0.0` (frap129, 2026-10-20) loads on 2.0.32, but we're building our own and not forking it. A cross-family review (gpt-6-astra, high confidence) and isolated probes found these problems in 2.0.0:

- It ignores `description`, `alwaysApply` and Claude `paths`.
- It silently turns string `globs`, `paths` and Cursor description-only or manual rules into always-on rules.
- It watches `apply_patch` rather than V2's `patch` tool, so GPT models never trigger rules.
- It reads `session.context` through the wrong response envelope (`.data`), so restart dedupe is broken.
- It suppresses request-local rules on tool continuations.
- It snapshots each session's rules at startup, so `loadouts sync` edits don't reach running sessions.
- It lets frontmatter `hooks` run shell commands.

Ideas we keep from it: only successful tool observations count, rules have stable identity, per-session state is serialized, and the transcript is part of the delivery ledger.

## Model routing (for /orchestrate)

| tier | model |
|---|---|
| cheap / exploration | `applied/glm-5-3-flash-bt#high` |
| standard | `cui-bedrock/us-gov.anthropic.claude-sonnet-5-5#high` |
| strong | `cui-bedrock/us-gov.anthropic.claude-opus-5-5#high` |

Probes and e2e always pass `--model cui-bedrock/us-gov.anthropic.claude-haiku-5-5#high`, falling back to `…sonnet-5-5#high`. `opencode run` otherwise uses the root default model.

## Verified facts (OpenCode v2.0.32, 2026-10-23 — live probes + source at tag v2.0.32)

Probe projects, reusable as templates, live in `$W=/var/folders/hh/y90cz08d14j4nl2l8nncn7bh0000gn/T/opencode/`:

- `v2rules-probe-2032`: hooks, tools, commands, storage, startup race.
- `v2rules-skillprobe`: virtual skills.
- `v2rules-deliveryprobe`: tool-result delivery and compaction.
- `orules`: isolated-XDG install of opencode-rules@2.0.0, plus `env.sh`.

The V2 source clone is at `/tmp/opencode/research/opencode`.

**Loading and packaging**

- Default export: `{ id, setup }`. A zero-import plain object loads. `Plugin.define` is the identity function.
- The host is Bun. It transpiles `.ts` directly, including inside `node_modules`.
- The host also injects `@opencode/plugin` and `effect` as virtual modules. Never bundle them.
- npm and `github:` specs are installed by Arborist into `~/.cache/opencode/npm/…`. It installs `dependencies` and peers, with `ignoreScripts`. For git specs, pacote still runs `prepare`.
- Entry resolution is `<name>/server`, then `<name>`, through `exports`. There is no special manifest field.
- **Local directory plugins**, configured as an absolute path or auto-discovered:
  - They get no dependency install.
  - `package.json` is ignored.
  - The entry must be `<dir>/server.*` or `<dir>/index.*`.
  - So local dev works only from a checkout that already has `node_modules`, through a root `server.ts` shim.
- `opencode plugin add <npm|github:spec>` writes the spec into the global config's `plugins` array. There is no `--global` flag, and local paths are rejected. It rewrites the file with an atomic rename. ⚠ Evatt's `~/.config/opencode/opencode.jsonc` is a symlink to the loadouts source `~/dotfiles/loadout/opencode/opencode.jsonc`, so **don't use `plugin add` on this machine. Edit the source file instead** (Task 6).
- Plugin `setup` is awaited before the first `prompt` hook and the first model call. A 15 s setup was tested, and nothing was skipped. **There is no startup race for hooks.** Only the `plugin.list` and `skill.list` HTTP handlers skip the wait.

**Tool hooks**

`ctx.tool.hook("execute.after", e)` event: `{tool, sessionID, agent, messageID, id, input, status, result}`.

| tool | input | `result` shape | notes |
|---|---|---|---|
| `read` | `{path}` | `{output:{type:"file",uri}}` | `path` can also be a directory |
| `write` | `{path, content}` | | |
| `edit` | `{path, oldString, newString}` | | |
| `patch` | `{patchText}` | | Headers: `*** Add File:`, `*** Update File:`, `*** Delete File:`, `*** Move to:`. Only GPT models get `patch` (it replaces `edit` and `write` there). |

- Paths are whatever the model passed, relative or absolute. Resolve them against `ctx.location.directory`, which is canonical (e.g. `/private/var/...`).
- **Model-visible text = `e.result.content`.** It is always an array `[{type:"text",text}]` inside the hook, and it is re-normalized after the hook. `output` is never shown to the model.
- Appended content is persisted in the transcript and the model sees it **in the same turn**. It doesn't touch the system prefix, so it is cache-friendly. Measured: 0 cache-write tokens, against 376 when the same rule went into the system prompt.
- ⚠ **Models ignore a rule found in tool output as prompt injection** (0/6 complied) unless a static system note explains `<rule>` blocks (6/6 complied for read and edit with the note).
- ⚠ Tools called inside Code Mode's `execute` give the model `output`, so text appended to their content never reaches the model.

**Session hooks**

- `ctx.session.hook("context", e)` fires before every model call, including tool continuations.
  - `e.system` is an array of `{type:"text", text, cache?}` and is rebuilt on every request.
  - A rule marker inside a tool result is reachable at `e.messages[i]` with `role:"tool"` → `content[j].type:"tool-result"` → `.result`. That `result` is either `{type:"text",value}` or `{type:"content",value:[{type:"text",text}…]}`. **Scan the messages recursively for strings.**
- After compaction, `e.messages[0]` is a user message whose text starts with `<conversation-checkpoint>`, or a content part has `type:"compaction"`. The summary paraphrases `<rule>` blocks away: the **markers are gone**.
- `ctx.session.hook("prompt", e)` event: `{sessionID, messageID, prompt:{text, files?, agents?, skills?}, metadata?, delivery}`. Edits persist. `opencode run '<msg>'` wraps `text` in literal quotes.

**Skills, storage, location**

- `ctx.skill` has `list`, `transform` and `reload`.
  - The `transform` editor has `list`, `get`, `add`, `update` and `remove`.
  - `add({id, name, description, path /*abs*/, content, autoinvoke})` takes plain strings, and ids may contain `/` and `:`.
  - `autoinvoke:true` → advertised in native `<available_skills>` and loaded through the native `skill` tool `{id}`.
  - `autoinvoke:false` → hidden, but still loadable if the model guesses the id.
  - Pushing `{id}` onto `prompt.skills` in the prompt hook inlines `<skill_content…>` into the user message.
  - `reload()` re-runs the transforms.
- `ctx.storage` is a per-plugin JSON KV store: `get`, `set`, `remove`, `scan`.
- `ctx.location` is `{directory, project:{id, directory, canonical}}`. `project.id === "global"` means no VCS project.
- Global config dir: `process.env.OPENCODE_CONFIG_DIR ?? join(XDG_CONFIG_HOME || ~/.config, "opencode")`. It is not exposed on `ctx`, so the plugin has to recompute it.
- There is no instruction-entry API on `ctx`. Config `instructions` globs do work in 2.0.32, but they inject raw files, frontmatter included, and can't be scoped. MEMORY.md's "accepted but unresolved" note is stale; Task 6 corrects it.

**Harness semantics (official docs, fetched 2026-10-23)**

- **Claude** (`code.claude.com/docs/en/memory`):
  - `.claude/rules/**/*.md`.
  - `paths` is the only field read. It accepts a YAML list or a comma string, with brace expansion.
  - A rule with no `paths` is always loaded. A rule with `paths` loads on Read/Write/Edit of a matching file.
  - Patterns are relative to the directory that contains `.claude`. User rules are relative to the cwd.
  - `*.ts` matches root-level files only.
- **Cursor** (`cursor.com/docs/rules`):
  - `.mdc` files.
  - `globs` is a comma-separated string.
  - Frontmatter table:

    | frontmatter | mode |
    |---|---|
    | `alwaysApply:true` | always (globs and description ignored) |
    | `globs` | auto-attached |
    | `description` only | agent-requested |
    | neither | manual (`@rule`) |

- **Codex**:
  - `AGENTS.override.md` / `AGENTS.md` walk from the root to the cwd. OpenCode does the same natively, so there's nothing to add.
  - `~/.codex/rules/*.rules` is a Starlark exec-approval policy. It maps to OpenCode permissions, not to this plugin.
  - `AGENTS.override.md` and Cursor's nested on-demand `AGENTS.md` are out of scope.

## Design (frozen)

### Repo layout — `/Users/evatt/Desktop/non-cui-repos/opencode-rules-v2`

```
package.json  tsconfig.json  README.md  LICENSE (Apache-2.0)  .gitignore
server.ts                  # export { default } from "./src/index.ts"   (local-dir dev entry)
src/index.ts               # plugin wiring only
src/rule.ts                # parse + classify
src/match.ts               # pattern list normalization + matching
src/discover.ts            # rule dirs, scan, mtime cache (RuleIndex)
src/observe.ts             # paths from tool events / prompt files
src/deliver.ts             # render, marker scan, checkpoint detect, session state machine
test/{rule,match,discover,observe,deliver}.test.ts
scripts/e2e.mjs
.github/workflows/ci.yml   # copy ~/Desktop/non-cui-repos/opencodev2-btw/.github/workflows/ci.yml; steps: npm ci, typecheck, test
```

`package.json`:

```json
{ "name": "opencode-rules-v2", "version": "0.1.0", "type": "module", "license": "Apache-2.0",
  "description": "Cursor/Claude-style rules (.opencode/rules) for OpenCode V2",
  "repository": { "type": "git", "url": "git+https://github.com/evatths/opencode-rules-v2.git" },
  "exports": { ".": "./src/index.ts", "./server": "./src/index.ts" },
  "files": ["src", "server.ts", "README.md", "LICENSE"],
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run", "e2e": "node scripts/e2e.mjs" },
  "dependencies": { "picomatch": "^4.0.2", "yaml": "^2.8.0" },
  "devDependencies": { "@opencode/plugin": "^2.0.32", "@types/node": "^24", "@types/picomatch": "^4", "typescript": "^5.9", "vitest": "^3" } }
```

Packaging decisions:

- Ship TS source with no build step. Bun transpiles it, and npm and git installs pull in `yaml` and `picomatch`.
- `src/index.ts` uses **`import type` only** from `@opencode/plugin`: `export default { id: "opencode-rules-v2", async setup(ctx) {…} } satisfies Plugin`.
- `tsconfig`: copy `opencodev2-btw/tsconfig.json`, which uses `allowImportingTsExtensions` and `noEmit`. Drop the jsx lines.
- No TUI half.

### Types (frozen — `src/rule.ts`)

```ts
export type Mode = "always" | "scoped" | "requested" | "manual";
export interface Rule {
  key: string;          // abs file path with $HOME collapsed to "~"; marker `source` attr; dedupe key
  name: string;         // path relative to its rules/ dir, extension stripped, "/"-separated (e.g. "go-style", "frontend/components")
  file: string;         // absolute path
  base: string;         // dir globs resolve against: the dir containing `.opencode/` (project) or ctx.location.directory (global)
  scope: "global" | "project";
  mode: Mode;
  patterns: string[];   // only for scoped
  description?: string;
  body: string;         // frontmatter stripped, trimmed
  mtimeMs: number;
}
export function parseRule(file: string, text: string, ctx: { base: string; scope: Rule["scope"]; name: string; mtimeMs: number; home: string }): Rule | { error: string };
```

### Classification

The first match wins:

1. Frontmatter is only recognised if the file starts with `---\n`, and it ends at the next line that is exactly `---`. It is parsed with `yaml`.
   - A parse error or a non-object result → `{error}`. The rule is **disabled, and a warning is logged once per mtime** (fail closed).
2. `patterns = split(globs) ∪ split(paths)`.
   - Each of `globs` and `paths` may be a list or a comma string.
   - `split` breaks only on commas outside `{}` and `[]` and not escaped. It then trims each entry, strips a leading `./` or `/`, drops empties and dedupes.
   - Any other field type → error.
3. `alwaysApply === true` or `activation === "always"` → `always`.
4. If `patterns` is non-empty → `scoped`.
5. `alwaysApply === false` or `activation === "scoped"` or the extension is `.mdc` → `requested` if there is a non-empty `description`, else `manual`.
6. Otherwise (a `.md` file with none of those fields) → `always`. This is the Claude rule; `description` is ignored here.
7. An `activation` value other than `always` or `scoped` → error.

Loadouts output always carries `activation` + `alwaysApply`, and `globs`/`paths` lists when scoped, so it classifies unambiguously.

### Matching (`src/match.ts`)

```ts
export function splitPatterns(v: unknown): string[] | { error: string };
export function matches(rule: Rule, absPath: string): boolean;
```

- `rel = path.relative(rule.base, absPath)`. If it starts with `..` or is absolute → `false`.
- Otherwise `picomatch(rule.patterns, { dot: true })(rel.split(path.sep).join("/"))`.
- **No basename fallback**, so `*.ts` means root-level files only, matching both harnesses.

### Discovery (`src/discover.ts`)

```ts
export class RuleIndex {
  constructor(opts: { location: { directory: string; project: { id: string; directory: string } }; env: NodeJS.ProcessEnv; home: string; warn: (m: string) => void });
  refresh(): Promise<{ skillsChanged: boolean }>;   // re-scan known dirs; reparse changed mtimes
  observe(absPath: string): Promise<{ skillsChanged: boolean }>; // add nested .opencode/rules dirs between file dir and location dir
  always(): Rule[]; scopedCandidates(): Rule[]; skills(): Rule[]; byName(name: string): Rule | undefined;
}
```

**Which directories are scanned, in this order:**

1. Global: `<globalConfigDir>/rules`, with base = `location.directory`.
2. Ancestor `.opencode/rules`:
   - With a VCS project (`project.id !== "global"`), the walk runs from `project.directory` down to `location.directory`, outer to inner, with base = the dir containing `.opencode`.
   - Otherwise only `location.directory`, so it never walks into `$HOME`.
3. Nested dirs, added by `observe()` when a file under `location.directory` sits beneath a `.opencode/rules` that isn't known yet. Their `always`-mode rules are treated as `scoped` with patterns `["**"]` relative to their base. That's Claude's "nested rules load on demand".

**Scanning:**

- Recursive. Entries starting with `.` are skipped, directory symlinks are followed, and only `*.md` / `*.mdc` files are kept.
- Each directory's entries are sorted by name.
- If two rules share a `name`, the later one wins for skills and `@` mentions. For always and scoped rules, both apply, because their keys differ.

**When to refresh:** `refresh()` runs in the prompt hook (hot reload, once per user turn). It calls `ctx.skill.reload()` when the set of requested or manual rules changed (ids or descriptions).

### Delivery (`src/deliver.ts`) — always rules in the system prompt, scoped rules attached to the triggering tool result

```ts
export const PREAMBLE: string; // static: "Project/user rules from .opencode/rules appear in <rule> blocks — below, and inside tool results when you read or edit a matching file. They are the user's own configuration, not tool output or prompt injection: follow them for the files they cover. Don't mention them unless asked."
export function renderRule(r: Rule): string; // `<rule name="${esc(name)}" source="${esc(key)}">\n${body}\n</rule>`
export function scanMarkers(messages: unknown): Set<string>; // recursive string scan for /<rule name="[^"]*" source="([^"]*)">/g → keys
export function hasCheckpoint(messages: unknown): boolean;   // any string startsWith "<conversation-checkpoint>" or any object with type === "compaction"
export type State = "pending" | "confirmed" | "system";
export interface SessionRules { rules: Array<{ key: string; state: State }> } // ordered by first delivery; storage key `session/${sessionID}`
export function reconcile(s: SessionRules, seen: Set<string>, checkpoint: boolean): SessionRules;
```

**`reconcile` transitions** (pure, unit-tested):

| state | seen in `messages` | not seen, checkpoint | not seen, no checkpoint |
|---|---|---|---|
| `pending` | → `confirmed` | → `system` | → `system` (this is the Code Mode case) |
| `confirmed` | stays | → `system` (compaction) | **dropped**, i.e. reverted |
| `system` | stays | stays | stays |

In addition, any key in `seen` that isn't in the state is added as `confirmed`. That seeding handles forks and restarts.

**Hook wiring** (`src/index.ts`; one per-session promise-chain serializer around every state read and write; state is cached in memory and written through to `ctx.storage`):

- **`session.hook("context")`:**
  1. Load the state and reconcile it with `scanMarkers(e.messages)` and `hasCheckpoint(e.messages)`.
  2. If the index has any rule, push **one** system part: `PREAMBLE` + `renderRule` of every `always()` rule, in index order. This part only changes when rule files change.
  3. If any rule is in state `system`, push a second part rendering those rules in state order.
  4. Add no cache hints.
- **`tool.hook("execute.after")`:** runs when `status === "completed"` and `tool ∈ {read, write, edit, patch}`.
  1. Get paths via `observe.ts`.
  2. For each path that isn't a directory (`fs.stat`): call `index.observe(path)`, then collect `scopedCandidates().filter(matches)` whose key isn't already in the state.
  3. Append `{type:"text", text: renderRule(r)}` to `e.result.content`.
  4. Record each appended rule as `pending`.
- **`session.hook("prompt")`:**
  1. `await index.refresh()`, and `ctx.skill.reload()` if the skills changed.
  2. Treat `file://` uris in `prompt.files` as observations. Scoped rules matched this way go straight to state `system`, because there is no tool result to attach them to.
  3. Find every `@name` with `/(?:^|[\s"'(`])@([\w.\/-]+)/g`. When `index.byName(name)` is a `requested` or `manual` rule, push `{id: "rule/" + name}` onto `prompt.skills`. Create the array if needed, and dedupe.
- **`ctx.skill.transform`:** for each rule in `skills()`, call `editor.add({ id: "rule/" + name, name: "rule/" + name, description: description ?? "Manual rule " + name, path: file, content: body, autoinvoke: mode === "requested" })`. Skip it if `editor.get(id)` already exists.
- **Cleanup:** return a function that disposes all registrations.

**Observation extraction** (`src/observe.ts`):

```ts
export function observedPaths(tool: string, input: unknown, cwd: string, home: string): string[];
```

- read, write and edit: `input.path`.
- patch: every `*** (Add|Update|Delete) File: <p>` and `*** Move to: <p>` in `patchText`.
- Expand `~` and `path.resolve(cwd, p)`.

### Accepted trade-offs and limitations (document these in the README)

- A scoped rule arrives **after** the first read or edit of a matching file. An after-hook can't change arguments the model has already generated, so a write to a file it never saw gets the rule only after that write.
- Editing a rule mid-session doesn't re-deliver it if it was already delivered through a tool result. Always rules and rules in state `system` update on the next turn.
- Requested and manual rules follow native skill semantics:
  - Compaction may summarize them away; they stay loadable.
  - `autoinvoke:false` hides a rule but doesn't lock it.
  - `@mention` covers requested and manual rules only.
- Code Mode-nested file reads fall back to the system part, which costs one prompt-cache miss.
- Not read: `.claude/rules`, `.cursor/rules`, nested `AGENTS.md` on demand, `AGENTS.override.md`, keyword/branch/os conditions, and shell hooks.

## Tasks

### Task 1 — Scaffold repo + pure core (rule, match, observe) with unit tests     wave: 1   risk: low   conviction: high   tier: standard   milestone: no
**Goal:** the repo exists locally with the layout and `package.json` above. `src/rule.ts`, `src/match.ts` and `src/observe.ts` implement the frozen signatures, and their unit tests pass.

**Files:**
- Everything under `/Users/evatt/Desktop/non-cui-repos/opencode-rules-v2/` from the layout, except `discover.ts`, `deliver.ts`, `index.ts` and `e2e.mjs`.
- Each of those four gets a stub that exports its signatures and throws `"todo"`.

**Context:**
- The Design sections "Types", "Classification", "Matching" and "Observation extraction".
- Copy `ci.yml` and `tsconfig.json` from `~/Desktop/non-cui-repos/opencodev2-btw/`, adapted.
- Do `git init -b main` here. **Do not commit yet**; Task 5 sets the identity first.

**Tests must cover:**
- Each of classification rules 1–7.
- Cursor examples: `.mdc` with description only → `requested`; `.mdc` with nothing → `manual`; `alwaysApply:true` + `globs` → `always`; comma string `"src/**/*.{ts,tsx}, docs/*.md"` → 2 patterns.
- Claude examples: `.md` with no frontmatter → `always`; `paths` list → `scoped`.
- The loadouts rendered shape: `description`, `paths` list, `globs` list, `activation: scoped`, `alwaysApply: false` → `scoped`.
- Malformed YAML → error.
- `*.ts` doesn't match `src/a.ts`.
- A path outside `base` → no match.
- Patch header parsing, including Move to.

**Done when:** `npm install && npm run typecheck && npm test` is green in the new repo.

### Task 2 — RuleIndex discovery + hot reload     wave: 2   risk: low   conviction: high   tier: standard   milestone: no
**Goal:** `src/discover.ts` implements `RuleIndex` exactly as specified in "Discovery".

**Files:** `src/discover.ts`, `test/discover.test.ts`.

**Context:**
- Design "Discovery". Use `parseRule` and `splitPatterns` from Task 1.
- Global dir: `env.OPENCODE_CONFIG_DIR ?? path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "opencode")`.
- Tests use temp dirs under `os.tmpdir()`.

**Tests must cover:**
- Ordering: global first, then outer to inner, then names sorted.
- `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` are respected.
- With no VCS (`project.id === "global"`), there's no ancestor walk.
- A nested dir is discovered by `observe()`, and its always rule becomes a `**`-scoped rule.
- mtime change → reparse. Adding or removing a requested rule → `skillsChanged: true`.
- Dot-dirs are skipped and symlinked dirs are followed.

**Done when:** `npm test -- discover` is green.

### Task 3 — Delivery state machine + plugin wiring     wave: 2   risk: high   conviction: high   tier: strong   milestone: yes
**Goal:** `src/deliver.ts` (pure) and `src/index.ts` (wiring) implement "Delivery" exactly. This is one owner on purpose: the state machine, hook ordering and serialization are entangled.

**Files:** `src/deliver.ts`, `src/index.ts`, `server.ts`, `test/deliver.test.ts`.

**Context:**
- Design "Delivery", plus the Verified-facts bullets on hooks, result content, markers, checkpoint, skills and storage.
- Working reference code: `$W/v2rules-deliveryprobe/.opencode/plugins/probe.js` (scan, checkpoint, content append), `$W/v2rules-skillprobe/.opencode/plugins/probe.js` (skill transform and prompt.skills) and `$W/v2rules-probe-2032/.opencode/plugins/probe.js`.
- Wrap each hook body in try/catch with `console.warn`, so a plugin bug never fails a tool or a prompt.

**Tests (pure):**
- Every row and column of the `reconcile` transition table, plus seeding.
- `scanMarkers` on both tool-result shapes and on nested arrays.
- `hasCheckpoint` on both forms.
- `renderRule` escaping.

**Done when:**
- `npm run typecheck && npm test` is green.
- `$W/v2rules-probe-2032` copied to a fresh dir, with the probe plugin replaced by `{"plugins": ["<abs path to repo>"]}` in that project's `opencode.json`, loads the plugin.
- `opencode run --standalone --auto --model cui-bedrock/us-gov.anthropic.claude-haiku-5-5#high "Read src/main.go, then list every SENTINEL token in your context"` quotes a scoped Go-rule sentinel.

### Task 4 — Live e2e script     wave: 3   risk: low   conviction: high   tier: standard   milestone: yes
**Goal:** `npm run e2e` proves every activation mode against the real OpenCode, isolated from the user's setup.

**Files:** `scripts/e2e.mjs`.

**Setup:**
- Make a temp project with `mkdtemp` under `os.tmpdir()/opencode`, then `git init`.
- Point all four `XDG_*` at the temp dir. Copy the `cui-bedrock` provider block from `~/.config/loadouts/opencode/opencode.jsonc` into an isolated `opencode.json` that has `"plugins": ["<repo abs path>"]` and `enabled_providers: ["cui-bedrock"]`. The `apiKey` is `{env:CUI_BEDROCK_API_KEY}`, which is already in the env.
- Pattern reference: `$W/orules/env.sh` and `loadout/scripts/opencode-session-restart-e2e.mjs`.
- `opencode run --standalone` uses a private server. Never call `opencode service`/`plugin list` without an isolated port.

**Fixtures:** one sentinel per mode.

| fixture | mode |
|---|---|
| `.opencode/rules/always.md`, no frontmatter | always |
| `go.md`, `paths: ["src/**/*.go"]` | Claude `paths` |
| `cursor.mdc`, `globs: "src/**/*.go"` | Cursor comma string |
| `py.md`, `globs: ["**/*.py"]` | negative control: must NOT appear |
| `db.mdc`, `description: "Use for database migrations"` | requested |
| `manual.mdc`, no fields | manual |
| global `<xdg>/opencode/rules/global.md` | global always |

**Runs:** each with `--model cui-bedrock/us-gov.anthropic.claude-haiku-5-5#high` and the instruction "list every SENTINEL token you received".

| run | prompt | must report |
|---|---|---|
| (a) | "Say hi" | always + global; not go / cursor / py |
| (b) | "Read src/main.go…" | always + global + go + cursor; not py |
| (c) | "How do I write a database migration? Load any applicable skill first" | db |
| (d) | "Use @manual …" | manual |

Each run asserts on the sentinels and exits non-zero on failure. The script prints the temp path.

**Done when:** `npm run e2e` prints all ✓, twice in a row.

### Task 5 — GitHub repo under the personal identity + first push     wave: 4   risk: low   conviction: high   tier: cheap   milestone: no
**Goal:** `github.com/evatths/opencode-rules-v2` exists, and every commit is authored by the personal identity.

**Files:** git config of the new repo only.

**Steps:**
1. In the new repo: `git config user.name "Evatt Harvey-Salinger"` and `git config user.email evatt.harveysalinger@gmail.com`. This email was determined from the local config of `evatths/loadouts` and `evatths/opencodev2-btw`. The global git identity is the work one, so this local override is mandatory.
2. `git add -A && git commit -m "feat: opencode-rules-v2 initial release"`.
3. Verify before any push:
   - `git log --format='%an <%ae>'` shows only the gmail identity.
   - `GH_TOKEN=$(gh auth token -u evatths) gh api user --jq .login` prints `evatths`.
4. `GH_TOKEN=$(gh auth token -u evatths) gh repo create evatths/opencode-rules-v2 --public --source . --remote origin --push`.
   - The remote must be `https://github.com/evatths/opencode-rules-v2.git`. The osxkeychain credential for github.com is used by gh's git credential helper. If the push prompts or authenticates as the work account, run `gh auth switch -u evatths && gh auth setup-git` first.

**Done when:**
- `GH_TOKEN=$(gh auth token -u evatths) gh repo view evatths/opencode-rules-v2 --json owner,defaultBranchRef` shows owner `evatths`.
- `git log origin/main --format='%ae' | sort -u` prints only `evatt.harveysalinger@gmail.com`.

npm publish is **not** part of this plan. It needs Evatt's npm login (`npm whoami` → 401 today). The name `opencode-rules-v2` is free.

### Task 6 — Install globally + verify in the real setup     wave: 5   risk: low   conviction: high   tier: standard   milestone: yes
**Goal:** Evatt's global OpenCode loads `opencode-rules-v2` from GitHub instead of the stale `opencode-rules@latest`.

**Files:** `~/dotfiles/loadout/opencode/opencode.jsonc`. That's the source file behind the `~/.config/opencode/opencode.jsonc` symlink. Don't use `opencode plugin add`: its atomic rename would replace the symlink.

**Steps:**
1. Replace line `"plugin": ["opencode-rules@latest"],` (≈ line 1374, the V1 key) with `"plugins": ["github:evatths/opencode-rules-v2"],`.
2. Run `opencode service restart`.
3. Commit in `~/dotfiles`, whose local identity is already the gmail one.

**Done when:**
- The server log `~/.local/share/opencode/log/opencode.log` shows `loading plugin … opencode-rules-v2` with no `failed to load plugin`.
- A real session in the loadout repo reading `src/builtins/tools/opencode.ts` gets `~/dotfiles/opencode/rules/agent-definitions.md`-style scoped rules when it touches `**/agents/*.md`. Spot-check with one `opencode run --model …haiku… "Read src/builtins/agents/… then list rule names you received"`.

### Task 7 — Loadouts integration     wave: 3   risk: low   conviction: high   tier: standard   milestone: yes
**Goal:**
- `loadouts check` warns when rules render for opencode but the plugin isn't configured.
- Session equip doesn't deny `rule/*` skills.
- Session equip doesn't double-inject rules that are already on disk.
- Docs are updated.

**Files:**
- `src/integrations/opencode/rules-plugin.ts` (new), `src/cli/commands/check.ts`, `src/integrations/opencode/session.ts:89-91` and `src/integrations/opencode/delta.ts:42-46`.
- Their colocated tests.
- `docs/compatibility.md`, `MEMORY.md`, and delete `plans/FIX-OPENCODE-RULES-BUG.md`.
- Don't touch instruction rendering: `plans/COMPOSABLE-INSTRUCTIONS.md` owns that.

**Context:**
- `translateRuleFrontmatter` (`src/builtins/index.ts:50-64`) already emits `globs` mirrored from the `paths` list and `alwaysApply` mirrored from `activation`. The plugin reads all four fields, so **no transform change is needed**.
- The sanitizer always adds `description` and canonical `activation` (`src/core/config.ts:246-272`).

**Changes:**

1. **`rules-plugin.ts`:**
   - Export `rulesPluginConfigured(projectRoot: string): boolean`.
   - Check whether any of these mention `opencode-rules-v2` on a line not starting with `//` (a plain text search, since there's no JSONC parser in deps):
     - `opencode.json(c)` and `.opencode/opencode.json(c)` in `projectRoot`;
     - `<globalConfigDir>/opencode.json(c)`, with the global dir computed as in Design "Discovery";
     - a `<globalConfigDir>/plugins/opencode-rules-v2` dir.
2. **`check.ts`:** in `checkRoot`, after `planRender`, if `plan.outputs.some(o => o.spec.tool === "opencode" && o.spec.kind === "rule")` and the plugin isn't configured, `log.warn` with this text:

   > `  ${name}: OpenCode rules render to .opencode/rules but OpenCode V2 only reads them with the opencode-rules-v2 plugin — add "github:evatths/opencode-rules-v2" to "plugins" in your global opencode.jsonc`

   Then set `hasWarnings = true`. Test it in `check` tests, or extract a helper and unit-test that.
3. **`session.ts`:** change `.filter((skill) => !selected.has(skill.id))` to also keep `!skill.id.startsWith("rule/")`, so rule skills are never denied. Update `session.test.ts`.
4. **`delta.ts:44`:** treat `drift.entry.kind === "rule"` as native when `rulesPluginConfigured(directory)`. Update the comment. Add a test in `delta.test.ts`, or the nearest existing test.
5. **`docs/compatibility.md`:**
   - OpenCode Rule cell: `.opencode/rules/<name>.md` (requires the `opencode-rules-v2` plugin).
   - Add a "Rules in OpenCode" bullet listing the four modes and the fields read: `description`, `globs`, `paths`, `alwaysApply`, `activation`.
   - Known Limitations: "OpenCode V2 core ignores `.opencode/rules`; without the plugin they're dead output (`loadouts check` warns)."
6. **`MEMORY.md`:**
   - Add a 3-line entry: the plugin repo, that it's required for opencode rules, and that `rule/*` skills are exempt from session denies.
   - Fix the stale claim that `instructions` is "accepted but unresolved". It is resolved in 2.0.32, with globs and URLs; we still render to `AGENTS.md`.
7. **Delete the superseded plan:** `rm plans/FIX-OPENCODE-RULES-BUG.md`. It's untracked.

**Done when:** `npm test && npm run lint && npm run build` are green, and `npm run loadouts -- check -v` in a project with an opencode rule and no plugin prints the warning.

## Verification (end to end)

1. New repo: `npm run typecheck && npm test` is green, and `npm run e2e` is all ✓ twice (Task 4).
2. Identity: `git log origin/main --format='%an <%ae>' | sort -u` gives exactly `Evatt Harvey-Salinger <evatt.harveysalinger@gmail.com>`, and `gh repo view` shows owner `evatths`.
3. Real install: the server log shows the plugin loaded, and the Task 6 spot-check run quotes a scoped rule. The TUI Plugins dialog (`ctrl+p` → Plugins) shows `opencode-rules-v2` active.
4. Loadouts: `npm test && npm run lint && npm run build` pass. `loadouts check -v` warns without the plugin and is silent with it.

## Assumptions (defaults taken without asking)

- The license is Apache-2.0, matching `opencodev2-btw`, and the repo is public.
- It's installed from GitHub (`github:evatths/opencode-rules-v2`). npm publishing is deferred to Evatt.
- `.md` files with no activation fields are always-on (Claude). `.mdc` files use the Cursor table.
- Glob semantics follow Claude and Cursor exactly: there's no basename matching.
- Malformed frontmatter disables the rule (fail closed with a warning), unlike Claude's fail-open behaviour.
- Rule skills are namespaced `rule/<name>` and `@mention` uses `<name>`. Evatt chose skills-backed requested and manual rules.
- No TUI sidebar, no extra condition types, and no shell hooks.
