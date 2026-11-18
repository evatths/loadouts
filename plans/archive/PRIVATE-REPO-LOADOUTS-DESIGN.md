# Private repo loadouts (private roots, `repo` loadout, derived suppression)

> **Archived design — not approved for implementation.** The active [OpenCode-first plan](../PRIVATE-REPO-LOADOUTS.md) supersedes these milestones, task briefs, and sign-offs. This copy preserves the earlier research for future harness reviews.

Tier: **plan file + task briefs**, built with `/orchestrate`. This is cross-cutting: discovery, state routing, resolution, the render pipeline, the OpenCode plugin and git integration. It replaces the signed-off `here`/`mute`/`hide` plan (2026-10-23). The safety material from that plan — tracked-path rule, exclude writer, sparse guardrails, OpenCode session work, ownership/recovery, probes — was reviewed by two consultants (Fable, Astra), and it is carried forward here adapted to the new layout.

## Goal

Evatt can bring his personal loadouts into any shared git repo without anyone seeing it. `git status` stays clean, no tracked file changes (including `.gitignore`), and untracked files exist only if hidden through `.git/info/exclude`. There are only two user-facing actions: **assemble personal loadouts** (from his own artifacts and the repo's tracked ones) and **activate/deactivate them** for a set of harnesses. Whether tracked team config gets muted or hidden is never something he decides. It is derived: once a private project has anything active, any tracked agent config that isn't in an active loadout is suppressed for the requested harnesses. Private projects persist across checkouts, worktrees and forks, and support monorepo subprojects. OpenCode 2.0.32 comes first, then Claude Code, Cursor and Codex, then Pi.

## Decisions (settled)

1. **Two project-root kinds, one nearest-wins walk.** The tracked root `<P>/.loadouts/` is unchanged (its state stays inside, git-ignored). The private root is `<common>/loadouts/<rel P>/.loadouts/`, where `<common>` = `git rev-parse --path-format=absolute --git-common-dir`. The repo-root private root is `<common>/loadouts/.loadouts/`. At each level of the cwd → toplevel walk, discovery checks both. The nearest level wins, and `projectRoot = <P>` in the checkout. If one level has both, the private root is primary and the tracked root is appended as a `source` (depth 1) right after it. Non-git directories are unchanged.
2. **Persistence comes from a symlink.** `<common>/loadouts` → `~/.config/loadouts/repos/<name>/`. If `<common>/loadouts` is a real directory instead, everything still works, just without persistence. The store file is `<common>/loadouts/loadouts.yaml` (`identity`, `projects`). Each private `.loadouts/` keeps its own ordinary root `loadouts.yaml` (version, sources) and its `loadouts/*.yaml` definitions and artifacts.
3. **Identity (M1.5).**
   - **Candidates.** Normalized remotes come first; any non-default SSH/HTTPS port is kept, so `ssh://git@h:2222/o/r` → `h:2222/o/r`. Root commits (`git rev-list --max-parents=0 HEAD`) are computed **only when no remote matches**, and are skipped when `--is-shallow-repository` is true or HEAD is unborn.
   - **Matching.** A store matches if its identity contains any candidate. On a match, the new IDs are appended. If several stores match, it is an error that lists them all.
   - **When identity runs.** Only when linking (`init --private`, or auto-link when `<common>/loadouts` is absent). Never when `storesDir()` is absent or empty, and never for `init`, `-g` or `--dry-run`.
   - **Dangling link.** If the link dangles and this checkout has nothing Loadouts-owned, warn and treat it as "no private roots". If it dangles while `ownership.json`, manifest entries, an exclude section or sparse config still exist, enter **recovery-only mode**: every command except `clear --private-recover` and `status` refuses. Recovery restores only this checkout, preserves held edits, backups and exclusions for retained user-enriched files, and removes the common link only when no worktree has outstanding ownership. There is never a silent fallback to ordinary behavior.
4. **State is per checkout:** `<gitDir>/loadouts-state/<rel P>/`, where `<gitDir>` = `--absolute-git-dir`. It holds `.state.json` and the composed `AGENTS.loadouts-generated.md` (plus `.bak`).
   - **`ownership.json` is per checkout**, at `<gitDir>/loadouts-state/ownership.json`, keyed by project (Objection 1).
   - **Private `.state.json` adds** `{ appliedTools: Tool[]; pending: boolean }`. Desired = `active`. `appliedTools` is the delivery set the filesystem was last reconciled to. `pending: true` means filesystem reconciliation hasn't happened yet (written by plugin-only init).
   - `CommandContext` gains `stateDir`. For non-private contexts `stateDir === configPath`, so behavior and bytes are identical to today.
5. **`Scope` stays `"global" | "project"`.** Both `CommandContext` and `LoadoutRoot` gain `private?: PrivateRootInfo`. Every consumer gets the worktree from `root.private?.projectRoot ?? dirname(root.path)`, never `dirname` of a private path. The old `worktreeForRoot`/separate-git-dir mapping is gone, because discovery already knows the toplevel.
6. **Selection.** The checkout's desired selection is `.state.json.active`. The shared choice lives in the store as `projects[P].default` and `projects[P].tools`; every private `activate`/`deactivate`/`clear` writes both, and `clear` sets `default: []`.
   - Auto-activate (Decision 11) reads `default` only when the checkout has **no state file**.
   - A change to `projects[P].tools` in the store affects **fresh checkouts only**. An existing checkout keeps its `appliedTools` until it reconciles, which happens through `sync`, `activate --tools` or `deactivate`. `status` shows the drift.
7. **`repo` is reserved and synthesized** in private contexts only. Its contents are the tracked native-layout artifacts that harnesses would read when working in `P`: matches at every ancestor level from `P` up to the toplevel, plus tracked nested `AGENTS.md`/`CLAUDE.md` below `P` (excluding anything under a deeper project root). They are computed **from the index** (`git ls-files`), never from disk, so sparse-hidden items stay in the set. A user definition named `repo` in a private root is an error. `repo:<repo-relative path>` includes a single tracked artifact by reference. Kinds come from the same registry mappings import-discovery uses. Nothing is ever copied into the store.
8. **Requested harnesses** are a delivery filter, separate from artifact `tools:` targeting. An existing checkout uses its recorded `appliedTools` for operational and session policy; shared `projects[P].tools` are defaults for fresh checkouts and drift reporting, not a live override. An explicit `--tools` operation or `sync` plans with the proposed set and persists it only after successful reconciliation. Fresh/plugin-seeded state starts from the store, defaulting to `[opencode]`. Apply the filter only at the filesystem-planning boundary, as `item.tools ∩ (requested − opencode)`, never to the resolved items `compileSession` consumes. In a private root, OpenCode is delivered through the session, never through files.
9. **Derived suppression.** This only happens when the private project's active set is non-empty, and only for requested harnesses `h`, over tracked `t ∈ repo(P)`.
   - **Per-tool active sets (L3).** `A_h` = the `origin.repoPath` values of active items whose resolved `tools` include `h`. Include-level overrides count, exactly as `runtime.ts:165` computes them.
   - **Classification:**
     - `t ∈ A_h`: if `h` natively reads `t`, leave it. Otherwise deliver a translated copy (hidden file or session).
     - `t ∉ A_h`: if `h` natively reads `t`, suppress it. Otherwise do nothing.
   - **Effective filesystem (L2).** "Natively reads" is evaluated against the **planned post-suppression filesystem**, with precedence and fallback rules (`NativeRead.unless`, `overriddenBy`). For example, if hiding `AGENTS.md` would make OpenCode or Claude fall back to an unselected `CLAUDE.md`, then that `CLAUDE.md` is suppressed too. Classification iterates to a fixed point. Index membership still defines the artifact universe and the tracked-file protection.
   - **Path ownership (L1).** Every tracked path is owned by exactly one project: the nearest private project root containing it. Projects nested inside `P` own their own subtrees. **Only the owner may assign `sparse`.** Ancestor-level artifacts (for example root `AGENTS.md` seen from `services/api`) use the session or config driver, or report `!` `no-driver`.
   - **Visibility conflicts (L1).** Serialize visibility-changing operations with one checkout-level coordinator lock. Inside it, reread project selections, explicit-session requirements and ownership; recompute conflicts; reconcile and commit selection/ownership before release. Explicit session equips use the same coordinator and reject requirements incompatible with existing suppression. If a path must stay natively visible for a project or session but its owner would hide it, reject the conflicting operation with `<path> is needed by <project|session>; it can't be hidden by <owner>`. Hide never wins. Clearing a project removes only its contribution.
   - **Driver order** for suppressing `t`, least invasive first: session (OpenCode M1, Pi M3), then config (Claude `claudeMdExcludes`, probe-gated; Codex override, L5), then working tree (non-cone sparse; owner only). Sparse is used only when some requested `h` that reads `t` has no other driver. Once `t` is sparse-hidden, the other drivers skip it.
   - **Unsuppressible `t`** (dirty, blocked by foreign/cone sparse config, `no-driver`, or a visibility conflict) shows `!` in status, never silence, and makes `sync`/`activate` exit nonzero.
   - **Visibility of sparse effects.** Activation output, including automatic activation, lists the paths sparse is about to hide (`⊘ hiding <path> (all harnesses in this checkout)`).
   - **Nothing active means nothing is managed.**
10. **Translation is the main new mechanism, with one read path (L4).** `src/core/source.ts` `readItemSource(item, file?)` reads an item's content and canonicalizes it in memory when `item.origin` is set: a `canonicalize(raw, item)` step keyed by `origin.nativeTool` and kind, built from `sanitizeRuleFrontmatterWithSummary` (`src/core/config.ts:214`) and the skill equivalents.
    - **Swapped in at every content read:** `render.ts` `renderOutput`, `delta.ts`, `runtime.ts` (`compileRuntimeBundle`, incl. the reads near `:333/:380/:452`), skill metadata reads, and the composer (`instructions.ts` near `:206`).
    - **Copies.** Rendered translated copies are always `mode: "copy"`.
    - **Unsupported translations** (agents, extensions, any kind without a canonicalizer) throw `cannot translate <repoPath> (<kind>) for <tool>`, which reports `!`.
    - Translation and composition have **one `strong` owner** (Task 5).
11. **Auto-link and auto-activate (M1.5).**
    - **Who calls it.** A CLI `preAction` hook and the OpenCode plugin's session init call `ensureCheckout(cwd, mode)`.
    - **Skips (L7).** The hook is skipped for `init`, `-g`, `--dry-run`, and whenever `storesDir()` is absent or empty.
    - **What it does.** It auto-links when exactly one store matches. If the nearest private root has no state file, it seeds `active = projects[P].default` and `appliedTools = projects[P].tools`.
    - **Modes (L6):**
      - `mutate`: CLI mutating commands. Runs the normal activate path and prints `Auto-activated <names> (repo default)` plus any sparse effects.
      - `plugin`: writes `.state.json` with `pending: true`, and nothing in the working tree.
      - `read`: `status`, `list`, `info`, `diff`, `doctor`. Never writes anything: no link, no state. It prints `Repo default <names> not yet applied — run loadouts sync` (or `Filesystem reconciliation pending — run loadouts sync` when `pending`).
    - **Catch-up.** Mutating commands clear `pending` after reconciling.
    - Claude SessionStart / Cursor `workspaceOpen` hooks that run `loadouts sync` are a documented follow-on.
12. **Carried-forward safety contract (unchanged in substance):**
    - **Tracked paths.** Index membership defines "tracked", checked before any collision logic, including for composed kinds. Tracked targets are never written, adopted or deleted. Removable directories with tracked descendants, and writes through tracked symlink ancestors, are rejected.
    - **Exclusions.** Private renders write exclusions only to `info/exclude`, in per-(worktree, project) marker sections. The entries are the union of rendered files and driver-owned files. `verifyIgnored` runs before writing, and patterns are escaped. No per-target `.gitignore`s.
    - **Serialization (L8).** Visibility-changing operations hold the checkout coordinator across the complete read/check/reconcile/commit. Shared store and `info/exclude` read-modify-writes additionally use their file locks and atomic temp+rename writes. Acquire locks in the fixed order coordinator → store → exclude; helpers called under the coordinator do not reacquire it. Never steal a lock merely because it is old while its owner remains alive; keep it until an asynchronous callback settles.
    - **Instructions.** Claude's private instruction goes to `CLAUDE.local.md`.
    - **Codex override (L5).** Codex's private instruction is `AGENTS.override.md` **at `P`'s level only**. It is a complete replacement that embeds every selected instruction it displaces at that level: the team `AGENTS.md` when it is in `A_codex`, plus the personal sources. When the team `AGENTS.md` is inactive, the override also serves as its suppression. Other harnesses never receive duplicated native content. An ancestor `AGENTS.md` seen by Codex from a subproject is `!` `no-driver`. This is gated on P-j (precedence, actual consumption, 32 KiB cap); if P-j fails, Codex instruction cells are `!`.
    - **Zero outputs.** A private apply with zero outputs still reconciles obsolete outputs.
    - **Drivers.** Preflight runs before any driver mutates. Applied and pending ownership are recorded so a partial failure can be recovered. Sparse is disabled only when the current config matches the recorded ownership.
    - **Sparse guardrails.** Refuse dirty paths, verify absence after applying, report resurrection, refuse pre-existing or cone configs, and disable sparse when nothing is left to hide.
    - **Imports.** Install/import never delete a git-tracked original.
    - **Codex.** A Codex skill cell is never green while the symlinked-`SKILL.md` limitation stands.
13. **In a private context, scope defaults to the private project.** `requireScopeForName` (`src/core/scope.ts:160`) sends global-only names to global scope today. When the nearest project root is private, it returns project scope unless `-g` is given. Without this, `activate acme` with a global `acme` would silently miss the private project.
14. **Dependency policy:** latest OpenCode only, no back-compat (MEMORY.md).

## Pre-paid context (from exploration; locate by symbol where line numbers drift)

- **Discovery.** `discoverLoadoutRoots` (`src/core/discovery.ts:29-73`) walks cwd → `findGitRoot` (async, `src/lib/git.ts`), pushing `{path:<dir>/.loadouts, level:"project", depth}`, then global. `getContext` (`:98-125`) uses `roots[0]` and sets `projectRoot = dirname(path)`, `statePath = join(path, ".state.json")`. `collectRootsWithSources` (`:239`) is a BFS over the primary root's `sources` (level `"source"`). `collectContextRoots` (`src/core/resolve.ts:154-181`) uses `discovered[0]` plus sources plus global plus bundled.
- **`LoadoutRoot`** (`src/core/types.ts:120-125`): `{path, level, depth, sourceRef?}`. **`CommandContext`** (`:128-133`): `{scope, configPath, statePath, projectRoot}`. **`ResolvedItem`** (`:57-62`): `{kind, sourcePath, relativePath, tools}`.
- **State reads that must use the state dir** (all of them are `loadState(<root>)` and read `<root>/.state.json` through `getStatePath`):
  - `manifest.ts:35` (`loadState`/`saveState :104`/`clearState :112` take a root dir)
  - `render.ts:299,571,793`
  - `tui/core/data.ts:170,184`, `tui/core/actions.ts:72`
  - `activate.ts:46,86`, `deactivate.ts:44,78`
  - `status.ts:373,621`, `info.ts:395,398,423,444`
  - `install.ts:491`, `diff.ts:69`, `render-engine.ts:96,183`, `remove.ts:33`, `instructions.ts:28`
  - `list.ts:337,356,382,383`, `sync.ts:40`
  - `integrations/opencode/delta.ts:37`
  
  The `ctx` sites become `loadState(ctx.stateDir)`. The `root.path` sites become `loadState(stateDirFor(root))`.
- **Composer.** `GENERATED_INSTRUCTIONS_FILE = "AGENTS.loadouts-generated.md"` (`src/core/instructions.ts:19`). `generatedPath: join(opts.loadoutRoot, …)` (`:225`). In `render.ts`, `join(loadoutRoot, GENERATED_INSTRUCTIONS_BACKUP)` is at `:506`, and `join(loadoutRoot, GENERATED_INSTRUCTIONS_FILE)` at `:576,819`. All of these switch to the state dir. Held-edit message text is in `src/lib/instruction-conflicts.ts:15` (a hard-coded `.loadouts/…bak` path, which must become dynamic). Attribute composed entries with `entrySources`/`expandDriftBySource` (`manifest.ts:210,218`), never `entry.sourcePath`. Claude `instructions.suppressedBy` = `["CLAUDE.md","CLAUDE.local.md",".claude/CLAUDE.md"]` (`claude-code.ts:23`).
- **Resolution.** `resolveLoadout` (`resolve.ts:33-66`): `effectiveTools = definition.tools || rootConfig.tools || BUILTIN`. `resolveInclude` (`:71-100`) joins `rootPath + relativePath`, requires existence, and calls `registry.inferKind(relativePath)` (canonical layout). The include-level `tools:` overrides the defaults.
- **Import discovery** (`src/core/import-discovery.ts`): `discoverImportableArtifacts(scanRoot, {scope, tools, kinds, sourcePath, loadoutPath})` (`:664`) loops over tools × kinds into `discoverForToolKind` (`:531`). That function builds a concrete template from `registry.resolveMapping(tool, kind).path`, `getScopeTemplate`, and `tool.basePath[scope]`. Instructions come from a central `discoverInstructions(scanRoot)`. `DiscoveredArtifact` = `{kind, name, sourcePath, displayPath, tool, size, mtime, destPath}`. It scans **disk**, so the repo set needs an index-path variant built on the same template logic.
- **Transforms.** `TransformFn = (raw: string, item?: ResolvedItem) => string` (`registry.ts:30`). `OutputMapping.transform` is at `:60`. `ToolSpec` (`registry.ts:92-108`): `{name, basePath, supports, targets?, instructions?: {maxBytes?, suppressedBy?}, validate?}`. Tools live in `src/builtins/tools/{opencode,claude-code,cursor,codex,pi}.ts`. OpenCode's skill target is `{base}/skills/{name}` with transform `opencode-skill-frontmatter` (copies), and its project instruction is `AGENTS.md`.
- **Render** (unchanged facts from the earlier review): CLI/TUI go through `applyMultiPlan(plans, ctx.configPath, …)` (`render-engine.ts:161`, `tui/core/actions.ts:43`). `planRender` handles collisions via `isUnmanagedCollision` (`manifest.ts:130-142`, which is false when the path is absent on disk, as with sparse-hidden paths) and `isAdoptableComposedCollision`. `refreshGitignores` calls `rebuildAllGitignores` and `updateLoadoutsGitignore`. `applyTargetSet` returns early on zero outputs (`render-engine.ts:139-143`). `clearState` is called at `render-engine.ts:84`.
- **Sync.** `sync.ts:41-57`: with no state it applies `rootConfig.default ?? "base"`, and the early-exit path calls `rebuildAllGitignores`.
- **Gitignore.** `src/lib/gitignore.ts`: `updateGitignoreFile` (`:58-108`) hard-codes `# <loadouts>`/`# </loadouts>`. `inspectGitignoreHealth` (`:286`) is used by doctor.
- **Install.** `install.ts:401-408` deletes originals unless `--keep`. `:885-901` hard-codes `<cwd>/.loadouts`, as do `init.ts:35,243` and `fallback.ts:18`.
- **Worktree-from-root consumers** (`path.dirname(<root>)`): `delta.ts:39-40`, `tui/core/data.ts:172`, `doctor.ts:594`, `skill.ts:150,333,476`, `rule.ts:130,302,378`. Re-grep `dirname(` near `.path`/`configPath` before editing.
- **OpenCode plugin** (`src/tui/hosts/opencode/index.ts`):
  - The `context` hook (`:52-67`) rewrites `event.system` with `filterSkillAdvertisement` (proven to reach the request; P1 in `docs/opencode-v2-runtime.md`), and fetches status only `if (added.size)`.
  - Auto-equip runs on `session.created` in an async loop (`:93-101`) that reads `opencode.defaultSession`.
  - `@opencode/plugin@2.0.32` `dist/promise/session.d.ts:129-142` exposes the `prompt`, `context`, `http.request`, `model.request` and `http.response` hooks.
- **Session equip.** `session.ts:89-91` denies every unselected catalog skill. Catalog skills carry an absolute `path` (`@opencode/schema/dist/skill.d.ts:11`). Manifest zod at `session.ts:11-23`. `compileSession` (`delta.ts:23-50`) builds ctx from `options.scope` (`:28`). On-disk exclusion (`:36-52`) compares symlinks against `drift.entry.sourcePath` unexpanded (this has to be fixed to the per-source rule). Skill entries read `<sourcePath>/SKILL.md` (`:66`).
- **Live instruction headers (2.0.32):** one block per file, headed `Instructions from: <absolute realpath>`. Session entries render after `AGENTS.md` in the same system part. OpenCode walks ancestor `AGENTS.md` files up to `$HOME`.
- **Existing e2e.** `scripts/opencode-session-e2e.mjs:32-38` writes `.opencode/skills/{alpha,beta}` as plain repo files and asserts `beta` is denied (`:54,73-74`). Additive gating breaks this, so it gets rewritten. The isolated service pattern is `scripts/opencode-session-restart-e2e.mjs` (`Service.ensure({… version: TESTED_OPENCODE_VERSION, command:["opencode","serve","--service","--hostname","127.0.0.1","--port","0"]})`, XDG under scratch).
- **Pi.** `src/tui/hosts/pi/embed-entry.ts:36` handles `before_agent_start` and returns `systemPrompt: event.systemPrompt + …`. The packages pin pi 1.3.0, but the installed `pi` CLI is 0.74.0.
- **Visual language** (`docs/visual-language.md:49-64`): `✓` ok, `+`/`~`/`-` changes, `!` error/held, `?` shadowed, `—` not applicable. There is no indicator for "suppressed", so Task 9 adds `⊘` (dim) = "suppressed — not in an active loadout".
- **Environment.** opencode 2.0.32, git 2.50.0, Claude Code 2.1.126 (below 2.1.277, so no native `AGENTS.md`), codex 0.134.0 (skips a symlinked `SKILL.md`). `~/.config/git/ignore` has `**/.claude/settings.local.json`.

## Frozen interfaces (Task 1 creates them; every later wave codes against them)

```ts
// src/lib/git.ts — sync helpers via execFileSync("git", args, { cwd, encoding: "utf8" })
export interface GitInfo { toplevel: string; gitDir: string; commonDir: string } // all realpath'd absolute
export async function findGitInfo(cwd: string): Promise<GitInfo | null>; // one `rev-parse --path-format=absolute --show-toplevel --absolute-git-dir --git-common-dir`; null outside git
export function findGitInfoSync(cwd: string): GitInfo | null;
export function gitPathSync(cwd: string, p: string): string;             // rev-parse --path-format=absolute --git-path <p>
export function trackedPathsSync(toplevel: string): Set<string>;         // ls-files -z --full-name; posix repo-relative; includes skip-worktree
export function isTrackedSync(toplevel: string, rel: string): boolean;   // file in index, or dir with indexed descendants
export function dirtyPathsSync(toplevel: string, rels: string[]): string[]; // status --porcelain -z -- <rels>
export function gitEscapePattern(rel: string): string;                   // escape \ * ? [ ! # and leading/trailing space
export function identityCandidatesSync(toplevel: string): { remotes: string[] };   // remotes only; roots via rootCommitsSync
export function normalizeRemote(url: string): string | null;
//   git@host:org/repo(.git) | ssh://[user@]host[:port]/org/repo(.git) | https://[user@]host[:port]/org/repo(.git)
//     → "host/org/repo", or "host:port/org/repo" when the port is non-default (ssh≠22, https≠443); host lowercased
//   file:///abs or /abs or ../rel (resolved against toplevel) → "file:" + realpath (needed by local-clone tests); anything else → null
export function rootCommitsSync(toplevel: string): string[];             // [] when shallow or unborn; called only when no remote matched

// src/lib/lock.ts (new; Task 1)
export function withLock<T>(lockPath: string, fn: () => T | Promise<T>, opts?: { staleMs?: number; waitMs?: number }): Promise<T>;
//   mkdir is exclusive; record pid+time, release in finally only after fn settles.
//   An old lock is removable only when its owner is verifiably dead; unknown liveness fails closed.
//   Wait up to waitMs (default 10_000), then throw LockTimeoutError; staleMs defaults to 30_000.
export function writeFileAtomic(p: string, data: string): void;        // temp in same dir + renameSync

// src/core/private-root.ts (new)
export interface PrivateRootInfo {
  git: GitInfo;
  projectPath: string;   // posix, repo-relative; "." for toplevel
  projectRoot: string;   // absolute <toplevel>/<projectPath>
  stateDir: string;      // <gitDir>/loadouts-state[/<projectPath>]
  worktreeId: string;    // "." main checkout; posix relative(commonDir, gitDir) for linked (e.g. "worktrees/main")
}
export const REPO_LOADOUT = "repo";
export const REPO_REF_PREFIX = "repo:";
export function privateLinkPath(git: GitInfo): string;                    // <commonDir>/loadouts
export function privateRootPath(git: GitInfo, projectPath: string): string; // <commonDir>/loadouts[/<projectPath>]/.loadouts
export function stateDirFor(root: LoadoutRoot): string;                   // root.private?.stateDir ?? root.path
export function projectRootFor(root: LoadoutRoot): string;               // root.private?.projectRoot ?? dirname(root.path)

// src/core/repo-store.ts (new)
export interface RepoStore {                // <commonDir>/loadouts/loadouts.yaml
  version: "1";
  identity: { roots: string[]; remotes: string[] };
  projects?: Record<string, { default?: string[]; tools?: Tool[] }>; // key = projectPath
}
export function readStore(git: GitInfo): RepoStore | null;
export function writeStore(git: GitInfo, store: RepoStore): void;          // atomic temp+rename
export function storesDir(): string;                                       // join(getGlobalConfigPath(), "repos")
export function findMatchingStores(c: { roots: string[]; remotes: string[] }): string[]; // store dirs whose identity intersects
export type LinkResult = { state: "linked" | "already" | "real-dir" | "none" | "dangling"; store?: string; learned?: string[] };
export function ensureLink(git: GitInfo): LinkResult;                      // throws AmbiguousStoreError listing dirs
export function createStore(git: GitInfo, name?: string): string;         // name default: "<org>-<repo>" from origin, else basename(toplevel); dedupe "-2"…
export function requestedTools(ctx: CommandContext, proposed?: Tool[]): Tool[]; // proposed set for sync/--tools; otherwise existing checkout's appliedTools; fresh state: store default ?? ["opencode"]; non-private: BUILTIN
export function recordSelection(ctx: CommandContext, active: string[], tools?: Tool[]): void; // writes projects[P].default (+tools)
export function forgetProject(ctx: CommandContext): void;                 // Task 14: drops projects[P] from the store (after cleanup)

// src/core/checkout.ts (new; Task 14 — M1 has no auto-link; the M1 plugin init only loads state)
export type CheckoutMode = "mutate" | "plugin" | "read";
export interface CheckoutResult { link: LinkResult; seeded: string[] | null; pending: boolean; notice?: string }
export function ensureCheckout(cwd: string, mode: CheckoutMode): Promise<CheckoutResult>;
//   L7 command/flag skips (init, -g, --dry-run) are the caller's; ensureCheckout itself returns early with
//   link.state "none" and zero git identity calls when storesDir() is absent or empty.
//   "read" never writes; "plugin" writes only .state.json { pending: true }; "mutate" links + seeds

// src/integrations/opencode/sessions.ts (new; Task 7) — <gitDir>/loadouts-state/sessions.json, under the checkout coordinator
export interface SessionRecord { projectPath: string; active: string[]; lastSeen: number } // explicit selections only; age is not evidence of deletion
export function recordSession(git: GitInfo, sessionID: string, rec: SessionRecord | null): void; // null removes
export function liveSessions(git: GitInfo): Promise<Record<string, SessionRecord>>; // revalidate against service; remove only confirmed-ended sessions; unverifiable records remain

// src/core/repo-artifacts.ts (new)
export interface RepoArtifact {
  repoPath: string;            // posix repo-relative (file, or skill dir)
  kind: ArtifactKind;
  name: string;
  nativeTool?: Tool;           // layout owner; undefined for cross-tool AGENTS.md
  absPath: string;             // <toplevel>/<repoPath> (may be absent on disk when sparse-hidden)
}
export function repoArtifacts(info: PrivateRootInfo, tracked?: Set<string>): RepoArtifact[]; // Decision 7, index-based
export function repoArtifactAt(info: PrivateRootInfo, repoPath: string, tracked?: Set<string>): RepoArtifact; // throws "not a tracked agent artifact: <p>"
export function nativelyReads(tool: Tool, a: RepoArtifact, info: PrivateRootInfo, present: (repoPath: string) => boolean): boolean;
//   evaluated against the planned post-suppression filesystem: `present` = tracked && not planned-hidden; honors NativeRead.unless/overriddenBy
export function owningProject(git: GitInfo, repoPath: string): string;  // nearest private project root containing repoPath ("." fallback)

// src/core/source.ts (new; Task 5) — the only content read path for resolved items
export function readItemSource(item: ResolvedItem, file?: string): string; // file = path inside a dir item (default: the item / SKILL.md)
export class UntranslatableError extends Error {}                           // "cannot translate <repoPath> (<kind>) for <tool>"

// types/schema
LoadoutRoot.private?: PrivateRootInfo;
CommandContext.private?: PrivateRootInfo;
CommandContext.stateDir: string;            // === configPath for non-private (Task 2a)
AppliedState.appliedTools?: Tool[]; AppliedState.pending?: boolean;   // private only; absent ⇒ tracked roots unchanged
ResolvedItem.origin?: { repoPath: string; nativeTool?: Tool };
ToolSpec.nativeReads?: NativeRead[];
interface NativeRead { glob: string; unless?: string; overriddenBy?: string }
//   glob relative to each base level (ancestors P..toplevel); `unless` = sibling path whose presence disables this read
//   (OpenCode/Claude: { glob: "CLAUDE.md", unless: "AGENTS.md" } per P-a/P-e); `overriddenBy` = Codex { glob: "AGENTS.md", overriddenBy: "AGENTS.override.md" }
OutputMapping.private?: { path: PathTemplate; mode?: OutputMode; transform?: TransformFn | string; compose?: "personal" | "replace-level" };
//   mode honored for composed instructions (today render.ts's composed-entries loop always writes `mode: "symlink"`, ~:737); "replace-level" = Codex override (L5)

// src/core/manifest.ts — frozen by Task 2a, consumed by every later wave
export function loadState(stateDir: string): AppliedState | null;
export function saveState(stateDir: string, state: AppliedState): void;
export function clearState(stateDir: string): void;
// src/core/render.ts — frozen by Task 2a
applyMultiPlan(plans, loadoutRoot: string, opts: { …existing, stateDir: string }); applyPlan(…, { stateDir }); removeManaged(…, { stateDir });

// src/core/suppression.ts (new) — pure; Task 5 produces, Tasks 7/8/10/11 consume
export interface SuppressionPlan {
  active: boolean;                          // false ⇒ nothing managed (all lists empty)
  leave: Array<{ tool: Tool; repoPath: string }>;      // in A_tool + natively read
  translate: Array<{ tool: Tool; item: ResolvedItem }>; // in A_tool + not natively read
  suppress: Array<{ tool: Tool; artifact: RepoArtifact; owner: string; ownedHere: boolean }>; // not in A_tool + natively read (post-suppression fixed point)
  conflicts: Array<{ repoPath: string; neededBy: string; owner: string }>;               // L1; any ⇒ caller rejects before mutating
}
export function planSuppression(ctx: CommandContext, active: ResolvedLoadout[], tools: Tool[], visibility: RequiredVisibility): SuppressionPlan;
export interface RequiredVisibility { paths: Map<string /*repoPath*/, string /*neededBy*/> } // from other active projects + sessions.json
export function requiredVisibility(git: GitInfo, exceptProject: string): Promise<RequiredVisibility>; // under checkout coordinator: reread project states + revalidated session records; unverifiable records block conflicting hides
```

- **Discovery rule.** `findGitInfo` runs once. At each walk level `L`, tracked = `<L>/.loadouts` (if it is a directory) and private = `privateRootPath(git, rel(toplevel, L))` (if it is a directory, following the symlink). For the private root, push `{path: private, level:"project", depth, private: info}`. For the tracked root at the same level, push `{… level:"project", depth, pairedWithPrivate: true}` immediately after it. `collectRootsWithSources(primary)` appends the paired tracked root as `{level:"source", depth: 1}` before BFS-ing the sources. `getContext("project")` sets `configPath = root.path`, `stateDir = stateDirFor(root)`, `statePath = join(stateDir, ".state.json")`, `projectRoot = projectRootFor(root)`, `private = root.private`.
- **`nativeReads` seed.** Task 0 verifies these and marks any it can't confirm `// unverified`; a probe verdict overrides the seed:
  - OpenCode: `AGENTS.md`, `CLAUDE.md` (fallback), `.opencode/**`, `opencode.json(c)`, `.claude/skills/*/`, `.agents/skills/*/`.
  - Claude: `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/**`, `AGENTS.md` (≥ 2.1.277, per the MEMORY stance).
  - Cursor: `AGENTS.md`, `.cursor/**`.
  - Codex: `AGENTS.md`, `AGENTS.override.md`, `.agents/skills/*/`, `.codex/**`.
  - Pi: `AGENTS.md`, `CLAUDE.md`, `.pi/**`, `.agents/skills/*/`.

  Nested `AGENTS.md` below `P` counts as natively read only for harnesses P-f/P-e show attach it.

## Milestones

### M0 — probes (no product code)
`docs/private-repo-probes.md` gives each probe a verdict, the evidence, the exact observed formats, and **the decision it fixes**. The orchestrator edits the affected briefs (Tasks 3, 7, 10, 11b, 13) before dispatching them.

### M1 — private roots (real `.git/loadouts` dir), state routing, `repo`, derived suppression, OpenCode session delivery
```sh
npm run lint && npm test && npm run build
node scripts/opencode-private-e2e.mjs        # new, isolated; prints ✓ lines, exit 0
node scripts/opencode-session-e2e.mjs        # rewritten for additive gating
node scripts/opencode-session-restart-e2e.mjs
```
`opencode-private-e2e.mjs` runs in a scratch `HOME` and XDG. Every git call uses `-c user.email=t@t -c user.name=t`. After **every** step it runs `assertInvisible(repo, baseline)`, which makes three separate comparisons:
1. **Index identity**: the `git ls-files -s` hash is unchanged.
2. **Working-tree status**: `git status --porcelain` equals the baseline captured for that step. It is empty, except in dirty-file cases, where the dirty baseline is captured first.
3. **Expected presence**: each listed path is present or absent as the step intends. Present tracked files are byte-identical to `git show HEAD:<p>`.

It also checks that `.git/info/exclude` bytes are unchanged and that `git config core.sparseCheckout` is unset or `false` (M1 never uses sparse).
- **Fixture.**
  - Bare `up.git` with one commit containing:
    - root `AGENTS.md` (`TEAM_MARKER`) and root `CLAUDE.md` (`CLAUDE_MARKER`)
    - `.opencode/skills/team/SKILL.md`, `.opencode/skills/keep/SKILL.md`
    - `.cursor/rules/style.mdc` (`CURSOR_MARKER`, `alwaysApply: true`)
    - `services/api/AGENTS.md` (`API_MARKER`), `services/api/.claude/skills/api-team/SKILL.md`
    - `services/web/.loadouts/` (team loadout `team-web`, committed, with its standard `.gitignore`)
  - Clone `A` from `file://up.git`.
- **Init and assemble.** In `A`, run `loadouts init --private`. In M1 this creates the **real directory** `A/.git/loadouts/.loadouts/` and a store file `A/.git/loadouts/loadouts.yaml` (identity left empty). Then write the private loadout `acme` into `A/.git/loadouts/.loadouts/loadouts/acme.yaml`. Its includes are its own instruction `ACME_MARKER`, its own skill `personal`, `repo:.opencode/skills/team` and `repo:.cursor/rules/style.mdc`. Run `loadouts activate acme`.
- **First turn.** The first prompt of a new session sends an outgoing request (to the stub, per P-c) that contains `ACME_MARKER`, `CURSOR_MARKER` (translated, because OpenCode doesn't read `.cursor/`), `<id>team</id>` and `<id>personal</id>`. It does **not** contain `TEAM_MARKER` (root `AGENTS.md` is not active, so it is suppressed) or `<id>keep</id>`. Directly invoking `keep` is denied.
- **Deactivating a team skill.** Edit `acme` to drop `repo:.opencode/skills/team` and run `loadouts sync`. The **next turn** of the same session lacks `<id>team</id>`, and invoking `team` is denied.
- **`repo`.** `loadouts activate repo` → the next request contains `TEAM_MARKER`, `team` and `keep`. `loadouts deactivate repo acme` (nothing active) → the next request is exactly what the team has: every tracked skill and `TEAM_MARKER` present, no Loadouts entries.
- **Monorepo.** From `A/services/api/src`: `loadouts init --private` then `loadouts activate repo`. Status shows project path `services/api`. Its `repo` set is `services/api/AGENTS.md`, `services/api/.claude/skills/api-team`, root `AGENTS.md`, and root `.opencode/skills/*`. It does not include `services/web/**`. A session opened in `services/api` gets `API_MARKER`.
- **Same level, tracked + private.** In `A/services/web`: `loadouts init --private`. `loadouts list` shows both `team-web` (from the tracked source) and the personal loadouts. `loadouts activate team-web` works, the tracked `.loadouts/` bytes stay unchanged, and the state lands in `.git/loadouts-state/services/web/.state.json`.
- **Worktree.** `git -C A worktree add ../wt`. In `wt`, `loadouts status` lists `acme` (definitions are shared through the common dir), while its state lives separately under `A/.git/worktrees/wt/loadouts-state/`. `loadouts activate repo` in `wt` doesn't change `A`'s `.state.json`.
- **Overlapping loadouts.** `acme2` also includes `repo:.opencode/skills/team`. Activate `acme acme2`, then `deactivate acme` → `team` is still present in the next request. Then `deactivate acme2` → `team` is denied.
- **Two sessions.** Session S1 runs `/loadouts equip acme` and session S2 runs `/loadouts equip acme3` (`acme3` includes `repo:.opencode/skills/keep` only). S1's request has `team` and lacks `keep`; S2's has `keep` and lacks `team`. Both are recorded in `sessions.json`, and neither touches the working tree.
- **Parent suppresses, child selects.** In `A`, `acme` is active, so root `AGENTS.md` is suppressed for the root project. In `services/api`, a loadout includes `repo:AGENTS.md`. A session in `services/api` gets `TEAM_MARKER` delivered (the session driver is per session directory and the root project never sparse-hides it in M1). A session at the root does not. Nothing on disk changes.
- **Private authoring.** `loadouts skill add <dir>` (and the rule/instruction equivalents) inside `A`: the artifact lands in the private root, `.gitignore` bytes are unchanged, and no `.loadouts/.gitignore` is created in the working tree.
- **Restart.** After a service restart, a new session in `A` equips from `.state.json`.

### M1.5 — persistence: store, identity, link, auto-activate
```sh
npm test && npm run build && node scripts/private-persistence-e2e.mjs   # new, isolated; exit 0
```
Uses the same fixture, scratch `HOME` and `assertInvisible`.
- **Init.** `loadouts init --private` in `A` (which still has the M1 real dir) moves the directory into `~/.config/loadouts/repos/<name>/`, replaces it with a symlink, and writes the identity remotes `[file:<up>]`. The root sha is written too, because `init` always records roots.
- **Fork.** `git clone file://up.git B && git -C B remote set-url origin file://elsewhere.git`. `loadouts sync` in `B` auto-links via the root sha (computed because no remote matched), learns `file:<elsewhere>`, and auto-activates `default`, printing `Auto-activated … (repo default)`.
- **Shallow clone.** `git clone --depth 1 file://up.git C` matches via the remote (`rootCommitsSync` is never called; assert it with a spy env `LOADOUTS_DEBUG_IDENTITY=1` that logs calls).
- **Ambiguity.** A second store whose identity overlaps makes `sync` exit nonzero, listing both. `status` warns and writes nothing.
- **Fresh worktree.** `git -C A worktree add ../wt3`, then `loadouts sync` → auto-activates `default`. Activating something in `wt3` changes the store's `default` but leaves `A`'s state alone.
- **Read-only commands.** `loadouts list` in a fresh worktree whose store has `projects["."].tools: [claude-code]` writes **nothing**: no state file, no working-tree files, and exclude bytes unchanged. It prints `Repo default <names> not yet applied — run loadouts sync`.
- **Plugin first.** Fresh clone `D` (identity matches, no CLI run). The plugin's session init auto-links and writes only `D/.git/loadouts-state/.state.json` with `pending: true`, and the first request already reflects `default`. Then `loadouts status` prints the pending notice, and `loadouts sync` clears `pending`. (Rendering the non-OpenCode tools on catch-up is asserted when Task 12 re-runs this script with `LOADOUTS_E2E_M2=1`; in M1.5 the M1 guard still blocks file rendering.)
- **Removal.** `loadouts clear --forget` in `wt3` cleans up that checkout and drops its project entry from the store; `assertInvisible` passes.
- **Tools drift.** Change `projects["."].tools` in the store from checkout `A`. In `wt3`, `status` shows `Tools: opencode (store: opencode, claude-code — run loadouts sync)` and an existing OpenCode session's behavior stays unchanged until local `sync` successfully reconciles the new set.
- **Concurrency.** Two worktrees run `loadouts activate` in parallel 20 times. The store file stays valid YAML, and both projects' `default` entries survive (`withLock`).
- **Dangling link.** Remove the store while `A` and a second worktree have owned state. `sync` refuses; recovering `A` leaves the shared dangling link in place and the second worktree recovery-only. Recover it separately; remove the link only after no worktree has outstanding ownership. Failed restoration keeps recovery receipts. After M2 adds file/config drivers, repeat with a held-edit backup and enriched Claude settings: preserve/export the backup and keep retained settings excluded.
- **No stores.** With `~/.config/loadouts/repos` absent, `loadouts status` in a plain repo performs no git identity calls (debug log is empty).

Vitest regression: a fixture repo with a tracked `.loadouts/` and no private root gives the same `getContext` result, `.state.json` location, rendered outputs and `.gitignore`s as before. Write this as a snapshot test in Task 2a **before** any state or discovery edit.

### M2 — private file render for Claude/Cursor/Codex, translation copies, exclude writer, Claude config driver, sparse driver
`scripts/private-render-e2e.sh` is HOME-isolated (`L="node $PWD/dist/index.js"`) and reuses the M1 fixture builder (`scripts/lib/private-fixture.mjs`, Task 9). After every step it calls `node scripts/lib/private-fixture.mjs assert <repo> <step>`. That is `assertInvisible`: index identity, status against the step baseline, and per-step expected presence. When a step sparse-hides a path, the expected presence is **absent**, and the index flag is `S`.
```sh
$L activate acme --tools opencode,claude-code,cursor
git check-ignore -q .claude/skills/personal/SKILL.md && ! test -e .claude/.gitignore && git diff --exit-code -- .gitignore
grep -q ACME_MARKER CLAUDE.local.md && ! test -e AGENTS.md && git ls-files -t AGENTS.md | grep -q '^S '   # inactive + Cursor reads it + no Cursor driver → sparse
$L status | grep -q 'shadowed.*AGENTS.md'                        # tracked, never a destination
$L status | grep -q '⊘.*AGENTS.md'                               # suppressed for cursor (sparse) and claude (excludes or sparse)
test -f .cursor/rules/style.mdc                                  # included via repo: in acme, so Cursor reads it natively (leave)
git worktree add -q ../wt2 && (cd ../wt2 && $L activate acme --tools claude-code && test -z "$(git status --porcelain)")
grep -q '# <loadouts:worktrees/wt2|\.>' .git/info/exclude && grep -q '# <loadouts:\.|\.>' .git/info/exclude
$L activate acme --tools opencode                                # Claude/Cursor outputs gone, drivers restored
! test -e CLAUDE.local.md && ! test -e .claude/skills/personal && test "$(git config core.sparseCheckout || echo false)" = false
$L clear && test -z "$(git status --porcelain)" && test -f AGENTS.md && ! grep -q '# <loadouts:\.|\.>' .git/info/exclude
```
Script cases:
1. **Sparse suppression.** With `--tools cursor` and `acme` active without the team `AGENTS.md`, `AGENTS.md` is absent and `git ls-files -t AGENTS.md` = `S AGENTS.md`. `activate repo` restores it (`H`) because it's active again.
2. **Dirty.** A dirty tracked file that would need sparse → status `!`, `sync` nonzero, file untouched.
3. **Resurrection.** `git stash pop` brings back a hidden file dirty → status `!` "suppressed but present", `sync` nonzero, file untouched. Once it's clean, `sync` re-hides it.
4. **Foreign or cone sparse** (`git sparse-checkout set --cone x`, or an edited `info/sparse-checkout`) → refused, and `clear` leaves it enabled.
5. **Claude config driver** (only if P-e is positive): suppressing the root `AGENTS.md`/`CLAUDE.md` for claude-code adds `<abs>/<p>` to `.claude/settings.local.json` `claudeMdExcludes` without sparse. Pre-existing keys and user entries survive `clear`. A Loadouts-created file that the user later enriches is kept, minus Loadouts' entries. If P-e is negative, Claude falls back to sparse and case 1's expectations apply.
6. **Consumption.** Installed Claude actually reads `CLAUDE.local.md` (captured request, or a `claude -p` codeword answer, per P-e). Codex skill cells are never `✓`.
7. **Translation to files.** With `--tools claude-code`, team `.cursor/rules/style.mdc` included through `repo:` renders as a canonicalized Claude rule copy (`.claude/rules/style.md`, `CURSOR_MARKER`, no Cursor-only keys), excluded. Cursor itself is not requested.
8. **Monorepo render.** From `services/api` with `--tools claude-code`: outputs land under `services/api/`, the exclude patterns are `/services/api/…` in section `loadouts:.|services/api`, and the root project's section is untouched.
9. **Fallback exposure (L2).** In the main block, after `AGENTS.md` is sparse-hidden:
   - OpenCode's next request lacks `CLAUDE_MARKER`, because `CLAUDE.md` is suppressed for OpenCode by the session strip once `AGENTS.md` is planned absent.
   - Claude's `CLAUDE.md` is suppressed via `claudeMdExcludes`, or via sparse if P-e is negative.
   - The status rows show `⊘` for `CLAUDE.md` under opencode and claude-code.
10. **Parent suppresses, child selects (L1).**
    - Setup: the root project is active with `--tools cursor` (it would sparse-hide root `AGENTS.md`), and `services/api` is active with a loadout that includes `repo:AGENTS.md` for cursor.
    - Whichever activation comes second exits nonzero with `AGENTS.md is needed by services/api; it can't be hidden by .`.
    - The working tree matches the baseline of the step before.
    - `deactivate` in `services/api` → the root activation then succeeds.
11. **Ancestor without a driver.** `services/api` is active with `--tools cursor` and doesn't include the root `AGENTS.md`. The root `AGENTS.md` shows `!` `no-driver (owned by .)` under cursor; it is not hidden; `sync` exits nonzero.
12. **Codex override (if P-j is positive).** At the root with `--tools codex`:
    - The team `AGENTS.md` inactive → `AGENTS.override.md` (excluded) contains `ACME_MARKER` only.
    - `activate repo acme` → it contains both `TEAM_MARKER` and `ACME_MARKER`.
    - Other harnesses' outputs contain no `TEAM_MARKER` copy.
    - A source set over 32 KiB warns.
13. **Concurrent exclude writes.** Two worktrees run `activate` in parallel 20 times. Both exclude sections survive and `ownership.json` stays valid JSON (`withLock`).
14. **Visibility race.** Race a parent hide against a child activation and an explicit session equip requiring the same native file. For each incompatible hide/require pair, at most one succeeds; compatible child and session requirements may both succeed. No successful selection loses its required file. Revalidate ended and unverifiable session records before hiding.
15. **Two-worktree recovery.** Repeat M1.5's dangling-link case after M2 with a held-edit backup and enriched Claude settings. Recover one checkout without losing either or its required exclusions; the other remains recovery-only until independently restored.

After M2 lands, re-run the full M1 block unchanged.

### M3 — Pi session driver (re-planned after its probe; single brief)

## Task briefs

Waves (every changed render/state signature is frozen in "Frozen interfaces" before the waves that depend on it):
- **0:** Task 0.
- **1:** Tasks 1, 2a.
- **2:** Tasks 2b, 3, 4.
- **3:** Tasks 5, 6.
- **4:** Tasks 7, 8.
- **5:** Task 9 (**M1**).
- **6:** Task 14.
- **7:** Task 15 (**M1.5**).
- **8:** Tasks 10, 11a, 11b (no shared files).
- **9:** Task 11c.
- **10:** Task 12 (**M2**).
- **11:** Task 13 (**M3**).

### Task 0 — M0 probes     wave: 0   risk: low   conviction: high   tier: standard   milestone: yes
Goal: `docs/private-repo-probes.md` resolves every probe below with a verdict and the decision it fixes.
Files: `docs/private-repo-probes.md` (new). Throwaway scripts go only under `/private/var/folders/hh/y90cz08d14j4nl2l8nncn7bh0000gn/T/opencode/`.
Context: use the isolated service exactly as in `scripts/opencode-session-restart-e2e.mjs`, with `HOME` also in scratch. The probe plugin lives at `$XDG_CONFIG_HOME/opencode/plugins/z-probe/index.ts`, modeled on `scripts/opencode-session-e2e.mjs:41`. Never touch the shared service or real configs.
- **P-a** (fixes `stripInstructionBlocks`, Task 7): dump `JSON.stringify(event.system)` with a tracked `AGENTS.md`, a symlinked ancestor `AGENTS.md`, `CLAUDE.md` with and without an `AGENTS.md` beside it, and one instruction entry. Record the part count, header line, separator and trailer, and the session-entry shape. Delete one block in `context` and confirm it's absent from the `http.request` body.
- **P-b** (fixes init ordering, Task 7): prompt immediately after create. In `prompt`, sleep 2 s, then call `instructions.entry.put`: does the entry show up in that turn's `context`? Does a `context` hook that awaits 2 s delay the request without an error? Does throwing from `prompt`/`context` block the turn with a visible error?
- **P-c** (fixes e2e model setup, Tasks 9/12): does `context`/`http.request` fire with provider baseURL `http://127.0.0.1:9`? If not, write and verify a minimal in-process OpenAI-compatible stub server.
- **P-e** (fixes Tasks 10, 11b and Claude's `nativeReads`): Claude 2.1.126 with `CLAUDE_CONFIG_DIR=<scratch>`; run `strings` on the binary first. Does `claudeMdExcludes` in `.claude/settings.local.json` suppress a tracked codeword `CLAUDE.md` given `<abs>/CLAUDE.md`, given `<abs>/AGENTS.md`, and given globs? Is `CLAUDE.local.md` loaded both as a regular file and as a symlink into `.git/…`? Does 2.1.126 read `AGENTS.md`? Does `permissions.deny: ["Skill(<name>)"]` hide or block a `.claude/skills` skill? If a model turn needs auth, stop and ask Evatt.
- **P-f** (fixes nested-`AGENTS.md` handling): does OpenCode 2.0.32 attach nested `AGENTS.md` to read-tool output? If so, record the format. If that attachment can't be stripped, a suppressed nested `AGENTS.md` goes to sparse (M2) and shows `!` in M1.
- **P-h** (fixes Decision 2): a symlink at `.git/loadouts` → outside dir survives `git gc --aggressive`, `git worktree add/prune`, `git fsck`, `git repack -ad`, `git maintenance run`. The same goes for a real dir `.git/loadouts-state` inside a linked worktree's git dir after `worktree prune` while the worktree exists. Record which of these commands remove or complain about it.
- **P-i** (fixes `identityCandidatesSync`): what `rev-list --max-parents=0 HEAD`, `rev-parse --is-shallow-repository` and remote URLs give for a full clone, a `--depth 1` clone, a `--filter=blob:none` clone, an unborn repo, a repo with two root commits (merged history), a submodule and `--separate-git-dir`. Also time `rev-list --max-parents=0` on a large repo, if one is available under `~/Desktop`.
- **P-j** (fixes `nativeReads`, Task 3): check every seed glob in "Frozen interfaces" against current docs (`webfetch` the OpenCode, Claude Code, Cursor, Codex and Pi docs). Specifically: Cursor reading `AGENTS.md`, `.claude/skills` or `.agents/skills`; Codex `AGENTS.override.md` precedence, **actual consumption** (`codex exec` codeword answer in scratch `CODEX_HOME`, or captured request), whether it is honored only at the cwd level or at ancestors too, and its 32 KiB cap; Pi's `CLAUDE.md` fallback and skill dirs; OpenCode's and Claude's `CLAUDE.md`-vs-`AGENTS.md` precedence (fills `NativeRead.unless`). Produce the final table and mark anything without a source `unverified`.
Done when: every probe has a verdict and a named decision, and the affected briefs are annotated.

### Task 1 — Foundations: git helpers, lock, private-root/store modules, types/schema     wave: 1   risk: low   conviction: high   tier: standard   milestone: no
Goal: every M1 interface in "Frozen interfaces" exists, with unit tests. The excluded parts are `repo-artifacts.ts` (Task 3), `source.ts`/`suppression.ts` (Task 5), discovery wiring (Task 2b), state signatures (Task 2a), and identity/link (Task 14, stubbed here as `throw new Error("M1.5")`).
Files: `src/lib/git.ts`, `src/lib/git.test.ts` (new), `src/lib/lock.ts` + test (new), `src/core/private-root.ts` + test (new), `src/core/repo-store.ts` + test (new; M1 part: `readStore`, `writeStore`, `requestedTools`, `recordSelection`, plus a stubbed `storesDir`/`findMatchingStores`/`ensureLink`/`createStore`), `src/core/types.ts` (Task 2a owns **all** `types.ts` edits in wave 1. Task 1 imports `PrivateRootInfo`, which it defines in `private-root.ts`, and does not edit `types.ts`), `src/core/registry.ts` (types only: `NativeRead`, `ToolSpec.nativeReads`, `OutputMapping.private`), `src/core/schema.ts` (store zod, non-strict; `repo` reservation helper).
Rules:
- `writeStore` and `recordSelection` run under `withLock(<store>.lock)` and write with `writeFileAtomic`, re-reading inside the lock before they merge.
- `normalizeRemote` keeps non-default ports.
- `~/.config/loadouts/repos` must be invisible to global-root operations. Grep for recursive walks of the global root (`listLoadouts`, kind directory scans, `rebuildAllGitignores`, `check`/`doctor`), and add `repos` to whatever reserved/ignored name list exists. Tests prove that `loadouts list -g` and the gitignore rebuild both ignore it.
Tests: tmp repos for a main checkout, a linked worktree named `main` (`worktreeId` = `worktrees/main`), a submodule, and `--separate-git-dir` (only the `commonDir` path changes); the remote normalization table incl. ports; `rootCommitsSync` on shallow/unborn repos (`[]`); `withLock` contention between two child processes, a long-running live owner never being evicted, dead-owner stale recovery, and lock retention until an async callback settles; tracked/dirty detection incl. directory descendants; pattern escaping; `recordSelection` merging per project.
Done when: `npx vitest run src/lib/git.test.ts src/lib/lock.test.ts src/core/private-root.test.ts src/core/repo-store.test.ts` passes and `npm run lint` is clean.

### Task 2a — State-dir refactor (no discovery change)     wave: 1   risk: low   conviction: high   tier: standard   milestone: no
Goal: `CommandContext.stateDir` exists (equal to `configPath` for every current root). Every state read/write and the generated/backup instruction files go through it. Tracked-root behavior is byte-identical.
Files: `src/core/discovery.regression.test.ts` (new; write it **first** and commit it green against current behavior: a fixture `.loadouts/` with two loadouts + composed instructions; snapshot `getContext`, the `.state.json` bytes and location, rendered outputs, `.gitignore`s and conflict-message text), `src/core/types.ts` (all of the frozen type fields: `stateDir`, `LoadoutRoot.private`/`CommandContext.private` typed via `import type { PrivateRootInfo } from "./private-root.js"`, `AppliedState.appliedTools`/`pending`, `ResolvedItem.origin`), `src/core/discovery.ts` (`getContext` sets `stateDir = configPath`), `src/core/manifest.ts` (`loadState`/`saveState`/`clearState(stateDir)`, signatures frozen above), every `loadState(` site in Pre-paid context (ctx sites → `ctx.stateDir`; root-path sites keep `root.path` for now, and Task 2b switches them to `stateDirFor(root)`), `src/core/render.ts` (`applyMultiPlan`/`applyPlan`/`removeManaged` take `{ stateDir }`; the generated file at `:576,819` and `.bak` at `:506` join `stateDir`), `src/core/instructions.ts:225`, `src/lib/instruction-conflicts.ts:15` (the hard-coded `.loadouts/AGENTS.loadouts-generated.md.bak` becomes a function of the backup path), `src/cli/commands/render-engine.ts`, `src/tui/core/actions.ts`.
Done when: `npm test` passes, and the regression snapshot is unchanged, i.e. the fixture's `.loadouts/` tree and `.state.json` bytes are identical. `grep -rn "loadState(ctx.configPath\|join(loadoutRoot, GENERATED" src` returns nothing.

### Task 2b — Private discovery, pairing, project-root consumers     wave: 2   risk: high   conviction: high   tier: strong   milestone: no
Goal: from any subdir, `getContext("project")` returns the private context per the discovery rule (real `.git/loadouts` dir in M1; a symlink works identically). Every consumer derives the worktree through `projectRootFor`. Non-private behavior is unchanged (the 2a snapshot stays green).
Files: `src/core/discovery.ts` (+ test), `src/core/resolve.ts` (`collectContextRoots` only, to pass the pairing through), the root-path state sites (`list.ts:337,356,382,383`, `info.ts:395,398`, `tui/core/data.ts:170`, `delta.ts:37`, `install.ts:491`, `instructions.ts:28` → `stateDirFor(root)`), and the worktree-from-root consumers: `delta.ts:39-40`, `tui/core/data.ts:172`, `doctor.ts:594`, `skill.ts:150,333,476`, `rule.ts:130,302,378` → `projectRootFor(root)`.
Context:
- Follow the discovery rule in "Frozen interfaces". `collectRootsWithSources` inserts the paired tracked root as a source. Use `owningProject` semantics for nested private roots (a deeper private root ends the parent's `repo` subtree).
- **Dangling link:** with no checkout-owned records, return no private roots and warn. If records exist, mark the context `recoveryOnly: true`; Task 6 enforces it.
Done when: `npm test` passes, with new tests for:
- a private root at the toplevel, and at a subproject (from a nested cwd)
- a linked worktree (shared root, distinct `stateDir`)
- a same-level tracked + private pair (private primary; tracked appears as a source in `collectContextRoots`)
- the generated file landing in `stateDir`
- both dangling-link branches

### Task 3 — Index-based `repo` artifact set + `nativeReads`     wave: 2   risk: low   conviction: high   tier: standard   milestone: no
Goal: `repoArtifacts`, `repoArtifactAt` and `nativelyReads` work from `git ls-files`, using the same mapping templates import-discovery uses. Each built-in tool declares `nativeReads` from P-j.
Files: `src/core/repo-artifacts.ts` + test (new), `src/core/import-discovery.ts` (export a pure `layoutPatterns(scope: Scope): Array<{tool, kind, base, pattern}>` extracted from `discoverForToolKind`'s template logic, `:531-560`, plus the instruction filenames from `discoverInstructions`; keep `discoverImportableArtifacts` behavior unchanged), `src/builtins/tools/{opencode,claude-code,cursor,codex,pi}.ts` (`nativeReads`).
Rules:
- Base levels are the ancestors of `P` up to the toplevel.
- A tracked path matches if `<base>/<pattern>` matches it. Directory kinds (skills) yield the directory once.
- Nested instruction files below `P` are tracked `**/AGENTS.md`/`**/CLAUDE.md`, minus those under a directory that has a deeper tracked `.loadouts/` or private root.
- Dedupe by `repoPath`. `nativeTool` = the matching tool, or undefined for root `AGENTS.md`.
- Exclude anything under tracked `.loadouts/` dirs and `GENERATED_INSTRUCTIONS_FILE`.
- **Ownership.** `repoArtifacts(info)` returns only paths that `info.projectPath` **owns** (via `owningProject`), plus ancestor-level artifacts flagged `ownedHere: false` (needed for classification, never sparse-able by this project).
- **`nativelyReads(tool, a, info, present)`.** True when one of the tool's `NativeRead.glob`s matches `a.repoPath` relative to a base level in `P..toplevel`, **and**:
  - the read's `unless` sibling is not `present`;
  - and no `overriddenBy` sibling is `present` or planned (the Codex override).
  
  `present` describes the planned post-suppression filesystem; Task 5 supplies it and iterates to a fixed point. Nested files count only per the P-f/P-e verdicts.
Done when: tests pass, including an **equivalence test**: on a fully checked-out fixture, `repoArtifacts` equals `discoverImportableArtifacts` filtered to tracked paths at each base. Further tests: a sparse-hidden artifact still appears; a monorepo subtree excludes its sibling project; `repoArtifactAt` rejects untracked and non-agent paths; the `nativelyReads` table matches P-j.

### Task 4 — Exclude writer     wave: 2   risk: low   conviction: high   tier: standard   milestone: no
Goal: a safe per-(worktree, project) `info/exclude` section writer.
Files: `src/lib/gitignore.ts` (`updateGitignoreFile(path, paths, marker = "loadouts")`), the new `updateExcludeSection(info: PrivateRootInfo, repoRelPaths: string[]): void` and `verifyIgnored(toplevel, repoRelPaths): string[]` (returns the paths `git check-ignore --no-index -q` reports **not** ignored), `src/lib/gitignore.test.ts`.
Rules:
- Marker is `loadouts:${worktreeId}|${projectPath}`, and the file is `gitPathSync(toplevel, "info/exclude")`.
- Entries are `/` + `gitEscapePattern(rel)`, with a trailing `/` for directories.
- The read-modify-write runs under `withLock(<exclude>.lock)` (Task 1), with a temp file and atomic `rename`, preserving other sections and user lines.
- After writing, re-read the file and `verifyIgnored` this section's paths. A missing section is now a bug (the lock serializes writers), so throw.
- Throw if the file is unwritable. An empty input removes the section.
Done when: tests show sections coexisting, both sections surviving 20 concurrent writers in two child processes, removal on empty input, the legacy `# <loadouts>` marker left untouched, escaping, and `verifyIgnored` catching a tracked-`.gitignore` negation (`!/.claude/`).

### Task 5 — Resolution: `repo` loadout, `repo:` refs, origin, translation, `planSuppression`     wave: 3   risk: high   conviction: high   tier: strong   milestone: no
Goal: in a private context, `repo` resolves to the project's tracked native artifacts, and `repo:<path>` includes work. Origin items are canonicalized in memory before any target transform. `planSuppression` implements Decision 9 as a pure function.
Files: `src/core/resolve.ts` (`resolveLoadout` options gain `private?: PrivateRootInfo`; `loadResolvedLoadouts` passes `ctx.private`), `src/core/translate.ts` + test (new), `src/core/source.ts` + test (new), `src/core/suppression.ts` + test (new), `src/core/render.ts` (content reads only, plus forcing `mode: "copy"` for origin items), `src/core/runtime.ts` (content reads only), `src/core/instructions.ts` (composer reads + `composeFor`), `src/integrations/opencode/delta.ts` (content reads only), `src/core/resolve.test.ts`.
Rules:
- `resolveLoadout("repo")` in a private context: if a definition named `repo` exists in the private root → throw `"repo" is reserved in private projects`. Otherwise synthesize `{name:"repo", tools: BUILTIN, items: repoArtifacts(info).map(toItem), rootPath: <private root>}` with `toItem(a) = {kind, sourcePath: a.absPath, relativePath: a.repoPath, tools, origin: {repoPath, nativeTool}}`.
- `resolveInclude` on `repo:<p>`: requires `private` (else throw `repo: includes need a private project (loadouts init --private)`). `repoArtifactAt` supplies the kind and source. The include-level `tools:` still applies.
- An origin item that is sparse-hidden (absent on disk) is fine to resolve. Reading its content happens only after reconcile has unhidden it (Task 11c ordering).
- `canonicalize(raw, item)`:
  - Rules: `sanitizeRuleFrontmatterWithSummary` (`config.ts:214`) maps Cursor/Claude/OpenCode rule frontmatter to canonical form.
  - Skills: the existing skill frontmatter parse + canonical keys.
  - Agents: the agent sanitizer if one exists; otherwise agents with `origin` are unsupported (throw, so it reports `!`).
  - Instructions: identity.
- `planSuppression(ctx, active, tools, visibility)`:
  - `active` empty or non-private → `{active:false, …[]}`.
  - For each `tool ∈ tools`, `A_tool` is the `origin.repoPath` values of active items whose resolved `tools` include that tool, including include-level overrides. For each `a ∈ repoArtifacts`:
    - `a ∈ A_tool` and natively read → `leave`
    - `a ∈ A_tool` and not natively read → `translate` (with the item)
    - `a ∉ A_tool` and natively read → `suppress`
  - Items with `repoPath` outside `repo(P)` (refs to other subtrees) still go to `leave`/`translate` against `nativelyReads`.
- **Fixed point (L2).** Start with `present = tracked`. Classify, remove the paths `suppress` would sparse-hide (only when `ownedHere`, and only when no non-sparse driver exists for some requesting tool, using the driver table in 11a, exported as a pure `driverFor(tool, artifact, probes)` from `suppression.ts`), and reclassify. Repeat until stable (at most `|repo|` iterations). The OpenCode `CLAUDE.md`-after-hidden-`AGENTS.md` case must come out as `suppress`.
- **Conflicts (L1).** Any planned sparse-hide of a path in `visibility.paths` → push to `conflicts` and don't hide it. Callers reject before mutating.
- **One content read path (L4).** `src/core/source.ts` `readItemSource(item, file?)` (canonicalizes when `item.origin`; otherwise a plain read). Swap it in at every content read: `render.ts` `renderOutput`, `delta.ts` (skill/rule reads, `:51-66`), `runtime.ts` `compileRuntimeBundle` (the reads near `:333`, `:380`, `:452`), skill metadata reads, and the composer (`instructions.ts` near `:206`). Grep `readFile(\|readFileSync(` across `src/core/{render,instructions,runtime}.ts` and `src/integrations/opencode/` afterwards; every remaining item-content read is a bug.
- **Composition.** The composer accepts origin instruction items (team `AGENTS.md` selected via `repo:`) and composes them through `readItemSource`. It exposes `composeFor(destination, items, mode: "personal" | "replace-level")`, which Task 10 uses for destination-specific content (Claude/Cursor = personal sources only; Codex override = replace-level, L5).
- `UntranslatableError` for agents, extensions and kinds without a canonicalizer.
Done when: tests cover:
- the reserved name; `repo` in the toplevel and subproject cases (owned paths only, ancestors flagged)
- a `repo:` dir skill and a file rule; untracked-ref and non-private errors
- Cursor `.mdc` → canonical rule → OpenCode/Claude target outputs with no Cursor-only keys, through `readItemSource` in render, runtime and delta alike
- the full `planSuppression` truth table incl. nothing active
- an item with `tools: [cursor]` not counting as active for opencode
- the hidden-`AGENTS.md` → suppressed-`CLAUDE.md` fixed point; a visibility conflict
- composed output with a team `AGENTS.md` origin source
- `compileSession` seeing every resolved item regardless of requested tools
- `UntranslatableError` for an agent

`grep` finds no direct item-content reads.

### Task 6 — Private lifecycle CLI: `init --private` (M1 real dir), selection recording, scope default, private gitignore policy, M1 guards     wave: 3   risk: low   conviction: high   tier: standard   milestone: no
Goal: Evatt runs `init --private` once, then `activate`/`deactivate`/`clear`/`sync`. Every private artifact-lifecycle operation leaves `.gitignore` and the working tree untouched.
Files: `src/cli/commands/init.ts` (`--private [--tools <list>]`), `activate.ts`, `deactivate.ts`, `sync.ts:38-60`, `render-engine.ts` (`applyTargetSet`, `clearAllOutputs`, `clearState :84`), `src/core/scope.ts:160`, `install.ts:401-408,791,885-901`, `fallback.ts:18`, and the private gitignore routing in `src/cli/commands/skill.ts:150-151` (plus its other `rebuildAllGitignores`/`updateLoadoutsGitignore` calls), `rule.ts`, `instructions.ts`, `add-to.ts`, `create.ts` (grep `rebuildAllGitignores\|updateLoadoutsGitignore\|updateGitignoreFile` in `src/cli/commands/` and route **every** hit). Also `src/core/private-root.ts` (M1 guard + `privateGitignorePolicy(ctx)`), and tests.
Rules:
- **`init --private` (M1).** Refuses outside git. Creates `privateRootPath(git, rel(toplevel, cwd))` as a **real directory** under `<common>/loadouts/`, containing a standard root `loadouts.yaml` (`version: "1"`), and creates or merges `<common>/loadouts/loadouts.yaml` (`identity: {roots: [], remotes: []}`). Sets `projects[P].tools = --tools ?? [opencode]` when unset, and prints the next step. It never creates `<cwd>/.loadouts`. Task 14 extends it with the store and link.
- **Private `activate`/`deactivate`.**
  - `--tools <list>` proposes a delivery set; commit this checkout's `appliedTools` and `projects[P].tools` only after successful reconciliation. Ordinary operations use checkout-local `appliedTools`; `sync` proposes the shared store's current desired tools.
  - After a successful apply: `recordSelection(ctx, newActive)` and `saveState({… appliedTools, pending: false})`.
  - The visibility-conflict check is wired in Task 11c. M1 has no sparse, so there are no conflicts yet.
- **Private `clear`** sets `active: []`, records `default: []`, keeps the state file (no resurrection), and removes only this project's contributions (exclude section, ownership entries).
- **Private `sync`** with empty `active` prints `Nothing active. Run: loadouts activate <loadout>`, exits 0, and never reads root `default`/`"base"`.
- **`requireScopeForName`** (`src/core/scope.ts:160`): when the nearest project root is private and `-g` is absent → project scope.
- **`recoveryOnly`** contexts (Task 2b): every command except `status` and `clear --private-recover` exits nonzero with `Store link is dangling and this checkout still has Loadouts-owned changes. Run: loadouts clear --private-recover`. `--private-recover` is implemented in Task 14 (M1.5); M1 only adds the refusal.
- **M1 guard.** `assertPrivateRenderingSupported(ctx)`: if `requestedTools(ctx) − opencode` is non-empty, throw `File rendering for private projects arrives in M2; OpenCode is delivered via session.` Otherwise private applies save `{active, entries: [], appliedTools, pending: false}`.
  - **Zero outputs still reconcile:** in a private context, `applyTargetSet` skips the zero-outputs early return and keeps existing entries until cleanup has run.
  - Task 10 deletes the guard.
- **Private gitignore policy.** In a private context every artifact-lifecycle command (`skill add/create/delete`, the rule and instruction equivalents, `install`, `add-to`, `create`) writes into `ctx.configPath` (the private root). It calls **no** `.gitignore` writer, so neither the working tree nor the private `.loadouts/` gets one. `install`'s `<cwd>/.loadouts` hard-codes use `ctx.configPath`.
- **Install.** `install` never deletes an original that is tracked in **the source's** repository (`findGitInfoSync(dirname(src))` + `isTrackedSync`, incl. directory descendants), in any scope, and prints `kept (tracked by git)`.
Done when: vitest (tmp repo, `HOME` overridden) covers:
- `init --private` at the root and in a subproject
- `default`/`tools` following the latest activate/deactivate/clear
- the scope default; the guard
- private `clear` → `sync` hint
- `skill add` / `rule add` / `install` in a private context leaving `.gitignore` bytes unchanged with no new `.gitignore` anywhere
- the recovery-only refusal
- keeping a tracked original

### Task 7 — OpenCode: idempotent init, per-turn refresh, additive gating, derived suppression, translation entries     wave: 4   risk: high   conviction: high   tier: strong   milestone: yes
Goal: the first turn already reflects the checkout's selection. Only Loadouts-managed unselected skills and suppressed repo skills are denied. Suppressed instruction blocks are absent from requests. Translated origin items are injected. Every turn follows the checkout's current state.
Files: `src/integrations/opencode/delta.ts`, `session.ts` (+ tests), `sessions.ts` + test (new), `advertisement.ts` (+ tests), `src/tui/hosts/opencode/index.ts`, `docs/opencode-v2-runtime.md`.
Interfaces: `SessionCompilation.gate: { roots: string[]; managed: string[]; suppressed: string[] }`, all realpath-canonical absolute:
- `managed` = absolute targets of `kind === "skill"` manifest entries in each discovered root's state (`stateDirFor`, `projectRootFor`).
- `suppressed` = `planSuppression(policyCtx, activeLoadouts, ["opencode"]).suppress` → `artifact.absPath`.

`advertisement.ts` exports `stripInstructionBlocks(text, drop: (abs) => boolean): string`, per P-a.
Behavior:
- **Policy context comes from the session directory:** `policyCtx = await getContext("project", directory).catch(() => undefined)`, regardless of `options.scope`. Outside any project there is no policy and no error.
- **Active set.** If the session has an explicit selection (`/loadouts equip`), use it. Otherwise the session **follows the checkout**: `loadState(policyCtx.stateDir).active`, re-read every turn.
- **Gate** (`session.ts:89-91`): deny skill `s` iff `!selected.has(s.id) && (under(canon(s.path), roots) || managed.includes(canon(s.path)))`, or `under(canon(s.path), suppressed)`. `under(p, L)` means `p === x || p.startsWith(x + "/")`. Repo-native skills that aren't suppressed stay available (additive).
- **Compile.** Origin items that OpenCode natively reads produce no entry (`leave`). `translate` items produce entries from canonicalized content (Task 5). On-disk exclusion iterates `expandDriftBySource(detectDrift(loadState(stateDirFor(root)), projectRootFor(root)))` and excludes a source only when its own drift is `ok` and its composed section matches the source content. Never compare against `entry.sourcePath`.
- **`index.ts`.**
  - `ensureSession(sessionID)` memoizes initialization only: it stores the in-flight promise, and on rejection deletes the memo before rethrowing, so the next hook (the next turn) retries instead of reusing a rejected promise.
  - **Init (M1)** loads `.state.json` from `policyCtx.stateDir` and equips; it writes nothing. Task 14 later inserts `await ensureCheckout(directory, "plugin")` before the equip (L6: state only, `pending: true`, zero working-tree files; filesystem reconciliation is left to the next CLI command). Checkout defaults apply only when the session has no explicit selection or unequip override, and in private roots only when `requestedTools` includes `opencode`.
  - **Per-turn `refreshSession`** (serialized per session) runs before each `prompt`, with `context` as the backstop. Recompute the resolved selection and suppression policy each turn; skip HTTP mutations only if the resulting content/policy fingerprint matches the last applied result. Include source content, definition membership, index artifact membership, effective filesystem/ownership, explicit selection and checkout-applied tools. State/store bytes alone are not evidence the policy is unchanged. An explicit equip/unequip clears the stored fingerprint. A shared store tool change does not alter an existing session before local reconciliation.
  - **Explicit selections are recorded** (`sessions.ts`, frozen above): `/loadouts equip|unequip` acquires the checkout coordinator, revalidates current visibility and rejects requirements incompatible with existing suppression before committing `recordSession(git, sessionID, {projectPath, active, lastSeen})`. Bump `lastSeen` on every refresh reconcile. Unequip-to-follow and a confirmed `session.deleted` remove the record; revalidate other records against the service before a conflicting hide. Age alone never proves deletion: unverifiable records block the hide with the session ID and actionable instructions to inspect the service and retry after confirmed deletion. Follow-mode sessions are not recorded (they add nothing beyond the checkout's state).
  - `session.created`, `prompt` and `context` all await init and then refresh, so the result doesn't depend on hook order.
  - Required failures throw from `prompt` with an actionable message (per P-b), never producing a silently unequipped turn.
- **`context`** always fetches status and applies `stripInstructionBlocks` (dropping block realpaths ∈ `suppressed`) and `filterSkillAdvertisement` with the predicate `!denied && !suppressed(path)`. If P-b shows entries written during `prompt` miss the first turn, `context` appends that turn's compiled entries (deduped by key); otherwise skip that branch.
- Suppressed artifacts that OpenCode has no session driver for (`.opencode/agents|commands|plugins/**`, `opencode.json`, and nested `AGENTS.md` if P-f is uncoverable) are reported by `status` (Task 8) as `!` "no driver until M2". The plugin only logs them.
- Non-private contexts: `suppressed` is empty, and the only behavior change is additive gating.
Done when: tests cover the gate, strip (P-a fixtures verbatim), manifest round-trip, the policy context under `scope: "global"`, no policy outside a project, a follow-mode session picking up a checkout `deactivate` on the next turn, an explicit selection surviving another turn, and a failing first `ensureSession` followed by a successful retry. An unchanged recomputed policy makes zero HTTP mutations; without editing `.state.json`, change a selected definition, edit an instruction and add a tracked native skill, and assert each next outgoing request and permissions reflect the change. Test explicit equip against existing suppression; confirm deleted sessions are removed, old but live sessions still block, and unverifiable sessions fail closed. A store tool change in another checkout leaves this session unchanged until local reconciliation. Also cover `requestedTools` without `opencode`, translated Cursor rules, composed-source exclusion and nothing active. Run `npm run lint`, `npm run build:embedded` and `npm run build`.

### Task 8 — Status and visual language for private projects     wave: 4   risk: low   conviction: high   tier: standard   milestone: no
Goal: `status` makes private delivery and suppression legible.
Files: `src/cli/commands/status.ts`, `src/cli/commands/list.ts` (mark `repo` as synthesized), `docs/visual-language.md` (add `⊘` dim = "suppressed — not in an active loadout"), `src/lib/artifact-table.ts` (only if the indicator needs registering), tests.
Behavior:
- **Private context.** A heading `Private project <projectPath>` followed by `keyValue` with: Store (path + name), Link (`linked`/`real dir`/`dangling`), State (`stateDir`), Active, Tools, and OpenCode plugin (`installed` if `~/.config/opencode/plugins/loadouts` exists, else `missing: run loadouts activate opencode-runtime -g`).
  - **Tools drift.** `Tools` shows the checkout's `appliedTools`; when it differs from the store's `projects[P].tools`, it reads `Tools: opencode (store: opencode, claude-code — run loadouts sync)` (warning color).
  - **Notices** (dim, after the key-values): `Filesystem reconciliation pending — run loadouts sync` when `.state.json.pending`; `Repo default <names> not yet applied — run loadouts sync` when `ensureCheckout(cwd, "read")` reports an unseeded default (Task 14 supplies it; in M1 the notice never fires); `Recovery-only: store link is dangling — run loadouts clear --private-recover` for `recoveryOnly` contexts.
  - **Sparse effects.** Below the table, one line per sparse-hidden path: `⊘ hidden <path> (all harnesses in this checkout)`, the same wording activation prints (Decision 9).
- **The table.** Rows are the active loadouts' artifacts, then every `repo(P)` artifact (`repo <repoPath>`). Columns are the requested tools, built dynamically. Cells:
  - `✓` delivered (natively or via a translated copy/entry)
  - `⊘` suppressed
  - `?` shadowed (tracked target)
  - `!` failed, unsuppressible, `no-driver`, or a visibility conflict — with a reason footnote (`dirty`, `foreign sparse config`, `no-driver (owned by <owner>)`, `needed by <project|session>`, `no driver until M2`)
  - `—` not applicable
  
  Follow `docs/visual-language.md` (artifact-first rows, dynamic tool columns, shared `artifact-table.ts`/`output.ts` helpers). Any `!` cell makes `status` print the footnote list; `status` itself still exits 0.
  When nothing is active, print `Nothing active — the checkout is exactly as the team has it.`
- In git with no private root, print dim `Personal loadouts here? Run: loadouts init --private`. Codex skill cells are never `✓` (`!` with "codex skips symlinked SKILL.md").
Done when: snapshot tests for active, nothing-active, no-root, tools-drift, pending and conflict (`!` with `needed by`) outputs pass, and `status | grep '⊘.*AGENTS.md'` matches in a fixture.

### Task 9 — M1 e2e scripts, fixture builder, runtime docs     wave: 5   risk: low   conviction: high   tier: standard   milestone: yes
Goal: the M1 acceptance block passes.
Files: `scripts/lib/private-fixture.mjs` (new; builds `up.git` — incl. root `CLAUDE.md` — `A`, `B`, `C`, `D` and the `acme`, `acme2`, `acme3` loadouts, and exports `assertInvisible(repo, before)`), `scripts/opencode-private-e2e.mjs` (new), `scripts/opencode-session-e2e.mjs`, `docs/runtime.md` (additive gating; a new "Private projects" section covering `init --private`, `repo` and `repo:`, derived suppression, `--tools`; Task 14 adds store/link/identity/auto-activate), `docs/opencode-v2-runtime.md`, `MEMORY.md`.
- **Behavior-change note (all users).** In `docs/runtime.md` and as a dated `MEMORY.md` entry: OpenCode session equips now gate skills **additively** — only Loadouts-managed unselected skills (and, in private projects, suppressed repo skills) are denied. Repo-native skills that aren't managed by Loadouts are no longer denied by `/loadouts equip`, in any project, private or not. Name the gate predicate's home (`session.ts`) so nobody "restores" the old deny-all.
Context: base it on the restart e2e. `env = {...process.env, HOME, XDG_*}` all under scratch. Copy `bundled/opencode/plugins/loadouts` (plus z-probe if P-c needs it) into `$XDG_CONFIG_HOME/opencode/plugins/`. If P-c is negative, start the stub server in-process **before** `Service.ensure` and assert on the bodies it receives. Invoke the CLI via `execFileSync(process.execPath, [dist/index.js, …], {cwd, env})`. In `opencode-session-e2e.mjs`, drop the plain `.opencode/skills/{alpha,beta}` writes (`:32-38`) so those skills are Loadouts-managed, and add a repo-native `.opencode/skills/native` that stays visible.
Done when: both scripts exit 0, the restart e2e still passes, and the additive-gating note is in `docs/runtime.md` and `MEMORY.md`.

### Task 14 — Persistence: store, identity, link, auto-activate, recovery     wave: 6   risk: high   conviction: high   tier: strong   milestone: no
Goal: a private project survives fresh clones, forks, shallow clones and worktrees through one store per repo, linked automatically, and a fresh checkout picks up the repo default without ever touching tracked files.
Files: `src/core/repo-store.ts` (+ test; replace the Task 1 stubs `storesDir`/`findMatchingStores`/`ensureLink`/`createStore`, add `forgetProject`), `src/core/checkout.ts` + test (new; `ensureCheckout`, frozen above), `src/cli/index.ts` (`cli.hook("preAction", …)`; `cli` is the `new Command()` at `:101`), `src/cli/commands/init.ts` (`--private` store + link, `--name`), `src/cli/commands/clear.ts` (`--private-recover`, `--forget`), `src/core/discovery.ts` (dangling-link branch reads `ensureLink` state only), `src/tui/hosts/opencode/index.ts` (insert `ensureCheckout(directory, "plugin")` into init, per Task 7), `docs/runtime.md` (store, link, identity, auto-activate, removal rule).
Uses Task 1's `identityCandidatesSync`, `normalizeRemote` (ports kept: `ssh://git@h:2222/o/r` → `h:2222/o/r`), `rootCommitsSync`, `withLock`, `writeFileAtomic`.
Rules:
- **Layout.** Store = `~/.config/loadouts/repos/<name>/`, containing `loadouts.yaml` (`RepoStore`: `identity: {roots, remotes}`, `projects[P]: {default, tools}`) and the per-project `[<P>/].loadouts/` private roots. `<common>/loadouts` is a symlink to it. Name = `<org>-<repo>` from `origin`, else `basename(toplevel)`; `--name` overrides; dedupe `-2`, `-3`….
- **Matching (`findMatchingStores` + `ensureLink`).** Candidates are normalized remotes first. Only if no store matches a remote, compute `rootCommitsSync` — skipped (returns `[]`) when `--is-shallow-repository` is true or HEAD is unborn — and match again. Exactly one match → link it and append every candidate not already in its identity (learning). More than one → `AmbiguousStoreError` listing every store dir; nothing written. Zero → `none`. With `LOADOUTS_DEBUG_IDENTITY=1`, log each identity git call to stderr (the e2e asserts on it).
- **`ensureLink` states.** Valid symlink → `already` (no identity calls). Real dir → `real-dir` (works, no persistence). Absent → match as above. Dangling symlink → `dangling` (no repair; see recovery). Creating the link runs under `withLock(<common>/loadouts.lock)`; on `EEXIST` re-read and return `already` if it points at the same store.
- **`init --private`** (extends Task 6): refuses outside git. Runs matching (always computing roots when no remote matches and not shallow). One match → link. None → `createStore`: if `<common>/loadouts` is the M1 real dir, move it into `repos/<name>/` (rename; copy+remove across devices) and replace it with the symlink; otherwise create a fresh store. Write identity `remotes` + `roots` (when computable). A real dir **and** a matching store → refuse: `Both <common>/loadouts and store <dir> exist; move or delete one`. Then create the project's private root inside the store if missing.
- **`preAction` gating (L7).** Skip for `init`, `-g`/`--global`, `--dry-run`, outside git, and (inside `ensureCheckout`) when `storesDir()` is absent or empty. Mode: `status`/`list`/`info`/`diff`/`doctor` → `read`; everything else → `mutate`. `AmbiguousStoreError` → nonzero exit for `mutate`; a warning for `read`.
- **Auto-activate.** Seeding happens only when the nearest private root has **no** `.state.json`. Source = `projects[P].default` / `projects[P].tools`, which Task 6's `recordSelection` keeps equal to the latest private `activate`/`deactivate`/`clear` from any checkout.
  - `mutate`, command `sync`: save `{active: default, appliedTools: tools, pending: false}` via the normal activate path, print `Auto-activated <names> (repo default)` plus the sparse-effect lines (Task 11c supplies them; none in M1.5).
  - `mutate`, command `activate`/`deactivate`: seed `active = default` in memory only, print the same line, and let the command apply once on top (no double render).
  - `mutate`, any other command (`clear`, authoring commands): link only; print the not-yet-applied notice.
  - `plugin`: under the checkout coordinator, re-read selections and visibility, then write `.state.json` with `{active: default, appliedTools: tools, entries: [], pending: true}`; no working-tree writes, no exclude writes. Do not introduce a separate state lock that bypasses the coordinator.
  - `read`: write nothing (no link, no state); return `notice: "Repo default <names> not yet applied — run loadouts sync"` (or the pending notice).
  - Empty `default` → no seeding and no message.
- **Catch-up.** Any `mutate` apply that reconciles the filesystem saves `pending: false`.
- **Recovery (dangling link).** Discovery (Task 2b) marks `recoveryOnly` when the link dangles and checkout records exist (`ownership.json`, manifest entries, an exclude section, sparse config or `sessions.json`); with no records it warns and treats the checkout as having no private roots. `clear --private-recover` restores only this checkout from its own records under the coordinator. Preserve or export held edits and backups before deleting any state; retain exclusions for user-enriched files that remain. Restore drivers and remove only safely owned manifest outputs, preserving receipts if any step fails. Examine all worktrees' owned state before removing the common dangling link; retain it while any worktree still needs recovery, so those worktrees remain discoverably recovery-only. Delete this checkout's recovery state only after its restoration and preservation succeed. Each step is idempotent after partial failure.
- **Removal rule.** Removing a private project or deleting a store must run cleanup first. `clear --forget` = private `clear` (full cleanup of this checkout), then `forgetProject` (drops `projects[P]` under the store lock). Docs state: run `loadouts clear --forget` (or `clear`) in each checkout before `rm -rf` of a store; if you didn't, `clear --private-recover` is the escape hatch.
- **Locks (L8).** Every store read-modify-write (`recordSelection`, learning, `forgetProject`) uses `withLock(<store>/loadouts.yaml.lock)` + `writeFileAtomic`, re-reading inside the lock.
Tests (vitest, tmp `HOME`, `file://` remotes): remote match without root computation (spy); fork matched by root sha + remote learned; shallow clone never calls `rootCommitsSync`; ambiguity lists both and writes nothing; `init --private` moving an M1 real dir (bytes preserved, symlink in place); real dir + matching store refused; each `ensureCheckout` mode × {no state, state, pending}; `read` mode writes nothing (fs snapshot); empty/absent `storesDir()` → zero git identity calls; `activate X` in a fresh checkout yields `default ∪ {X}` with one render; dangling link with and without records; two-worktree recovery keeps the link while the other checkout owns state and is idempotent after an injected failure; `clear --forget`; 20 parallel `recordSelection`s from two processes keep both projects. After M2 supplies file/config drivers, exercise preserved held-edit backups and enriched settings/exclusions in M2 case 15.
Done when: those tests pass, `npm run lint` is clean, and `npm run build:embedded && npm run build` are run.
Depends on: Tasks 1, 2b, 6, 7.

### Task 15 — M1.5 e2e     wave: 7   risk: low   conviction: high   tier: standard   milestone: yes
Goal: the M1.5 acceptance block passes end to end.
Files: `scripts/private-persistence-e2e.mjs` (new), `scripts/lib/private-fixture.mjs` (add helpers: `forkClone`, `shallowClone`, `addWorktree`, `identityLog(env)`).
Context: reuse Task 9's fixture builder, scratch `HOME`/XDG, CLI invocation (`execFileSync(process.execPath, [dist/index.js, …], {cwd, env})`) and the isolated OpenCode service + stub (P-c) for the plugin-first case. Every git call uses `-c user.email=t@t -c user.name=t`.
Steps (run `assertInvisible(repo, baseline)` after **every** step in every checkout touched — index hash unchanged, `git status --porcelain` equal to the step baseline (clean), expected presence, `info/exclude` bytes unchanged, sparse unset):
1. `init --private` in `A` (holding the M1 real dir) → `.git/loadouts` is a symlink into `$HOME/.config/loadouts/repos/<name>/`; identity has `file:<up>` and the root sha; `acme` still resolves.
2. **Fork:** clone + `remote set-url origin file://elsewhere.git` → `B`; `sync` auto-links via the root sha, the store learns `file:<elsewhere>`, `Auto-activated acme (repo default)` is printed.
3. **Shallow:** `clone --depth 1` → `C`; `sync` links via the remote; the identity log has no `rev-list` call.
4. **Ambiguity:** a second store with an overlapping identity → `sync` nonzero listing both; `status` warns and writes nothing; remove the second store.
5. **Worktree:** `worktree add ../wt3`; `sync` auto-activates `default`; `list` shows `acme` (shared definitions); `activate repo` in `wt3` changes the store `default` but not `A`'s `.state.json` bytes.
6. **Read-only:** a fresh worktree with store `tools: [claude-code]` → `list` writes nothing (no state file, no link change) and prints `Repo default … not yet applied — run loadouts sync`. Restore `tools: [opencode]`.
7. **Plugin first:** fresh clone `D`, no CLI run; open a session → `D/.git/loadouts` is linked, only `D/.git/loadouts-state/.state.json` exists with `pending: true`, and the first captured request contains `ACME_MARKER`. Then `status` prints the pending notice and `sync` clears `pending`. With `LOADOUTS_E2E_M2=1` (Task 12 re-runs it) the store tools include `claude-code` and `sync` must also render `CLAUDE.local.md` (excluded).
8. **Tools drift:** change `projects["."].tools` from `A`; `status` in `wt3` shows the drift line; its existing session and files remain unchanged until successful local reconciliation.
9. **Concurrency:** two worktrees run `activate` in parallel 20 times; the store stays valid YAML and both `default`s survive.
10. **Removal:** `clear --forget` in `wt3` → its checkout records are gone and `projects` no longer has its entry.
11. **Dangling link:** remove the store while `A` and another worktree have owned state. Recover `A`; the link remains and the other worktree is recovery-only. Recover the other worktree, then remove the link only after all owned state is restored; failed restoration preserves receipts. Repeat with held-edit backups and enriched settings/exclusions after M2 in case 15.
12. **No stores:** with `repos/` absent, `status` in a plain repo leaves the identity log empty.
Done when: `npm run build && node scripts/private-persistence-e2e.mjs` exits 0 and prints one `✓` per step, and the M1 scripts still pass.
Depends on: Task 14 (and Task 9's fixture).

### Task 10 — Private render pipeline: file delivery, translation copies, private instruction targets, tracked rule     wave: 8   risk: high   conviction: high   tier: strong   milestone: no
Goal: private renders for Claude, Cursor and Codex are invisible to git, never touch tracked paths, deliver instructions through private targets, deliver translated origin items as copies, and report shadows.
Files: `src/core/render.ts` (by symbol: `planRender`, `resolveOutputSpec`, `resolveExpandedOutputSpec`, `refreshGitignores`, `applyMultiPlan`, `removeManaged`, `isAdoptableComposedCollision`), `render.test.ts`, `src/core/instructions.ts` (+ test), `src/core/registry.ts` (resolver honors `OutputMapping.private`), `src/builtins/tools/{claude-code,cursor,codex}.ts`, `src/cli/commands/{render-engine,sync,doctor,status}.ts`, removal of `assertPrivateRenderingSupported` and its call sites. Re-read `claude-code.ts` and the composer before editing.
Rules (`priv = !!ctx.private`):
- **Delivery filter.** At the `planRender` input only: `item.tools ∩ (requestedTools − opencode)`, applied after definition and include overrides. Origin items: for the `leave` pairs from `planSuppression`, drop that tool. For `translate` pairs, render as copies (Task 5's canonicalize already runs). Never filter what `compileSession` sees.
- **Private instruction targets** (`OutputMapping.private`):
  - Claude: `CLAUDE.local.md`, a symlink to `<stateDir>/AGENTS.loadouts-generated.md`, or `mode: "copy"` if P-e shows symlinks into `.git` aren't loaded.
  - Cursor: `.cursor/rules/loadouts-personal.mdc` (copy; transform wraps the composed content with `alwaysApply: true` frontmatter).
  - Codex: `AGENTS.override.md` if P-j confirms the precedence. Its composed content also includes the team `AGENTS.md` at that level when it is active, because the override replaces it for Codex. When the team `AGENTS.md` is inactive, the override itself is Codex's suppression for it. Otherwise, Codex instruction cells are `!` "AGENTS.md is tracked".
  - Tracked `AGENTS.md` is never a destination.
- **Destination mode is honored.** Today every composed destination entry is written `mode: "symlink"` to the shared generated file (`render.ts` composed-entries loop, `mode: "symlink"` at `:737`). In a private context each destination instead takes its content and mode from `composeFor(destination, items, mapping.private.compose ?? "personal")` (Task 5) and `OutputMapping.private.mode`/`transform`: a `"symlink"` destination points at the composed file in `stateDir` **only when** its content equals the shared composition; otherwise (Cursor wrapper, Codex `replace-level`, a P-e copy verdict) the destination is a `mode: "copy"` file with its own `renderedHash`, still carrying `sources` for `entrySources`/`expandDriftBySource`. Held-edit detection compares each copy against its own expected content. Non-private renders are unchanged (the 2a snapshot stays green).
- **Tracked rule.** Compute `tracked = trackedPathsSync(toplevel)` once. For every spec, **including composed kinds**: if the posix repo-relative target is in `tracked`, or a tracked path lies under it (removable dir), or any ancestor is a tracked symlink → push to `shadowed` and skip. This check runs **before** `isUnmanagedCollision`, so sparse-hidden tracked paths are still shadowed. Stale removal and `removeManaged` skip the same set.
- **Instruction warnings** are destination-aware: `computeInstructionWarnings` skips a `suppressedBy` entry equal to the destination, and in private mode skips Claude's list entirely. Held-edit semantics are unchanged; backups go to `stateDir`.
- **Exclusions** = rendered destinations ∪ the driver-owned files from `ownership.json` for this project. Before writing outputs: `updateExcludeSection(info, union(old, new))`, then `verifyIgnored`. Any path that isn't ignored aborts the apply nonzero with nothing written. After saving state, the section = the new union.
- `refreshGitignores` in a private context writes only the exclude section, never `rebuildAllGitignores`/`updateLoadoutsGitignore`. The `sync` early exit behaves the same way.
- Doctor's private branch compares the exclude section with manifest ∪ owned. Status lists `? shadowed (tracked by repo): <path>`.
- Run `npm run build:embedded && npm run build` afterwards.
Done when: `render.test.ts`/`instructions.test.ts` cover:
- tracked shadow (present, and sparse-hidden-absent)
- composed `AGENTS.md` never symlinked when tracked
- a tracked descendant and a tracked symlink ancestor
- exclude-before-write, and abort on negation
- owned-file retention across regeneration
- `CLAUDE.local.md` with two sources, and no self-suppression warning
- per-destination modes: Claude symlink, Cursor copy with frontmatter, Codex `replace-level` copy, each with correct drift attribution and held-edit detection
- held edit + `--force`, with the backup in `stateDir`
- a translated `.mdc` → `.claude/rules/style.md` copy
- the delivery intersection with all-tools includes and `tools: [opencode]` → zero outputs, while `compileSession` still sees every item
- switching tools from Claude to OpenCode-only removes the Claude outputs and keeps `active`
- monorepo exclude patterns
- cleanup with tracked bytes and index unchanged

`npm test` passes.

### Task 11a — `reconcileSuppression` core + sparse driver     wave: 8   risk: high   conviction: high   tier: strong   milestone: no
Goal: `reconcileSuppression(ctx, plan: SuppressionPlan): Promise<SuppressionReport>` assigns each `suppress` pair a driver, preflights every driver, applies them, and makes the working tree match.
Files: `src/core/reconcile.ts` + test (new).
- **Conflicts first (L1).** If `plan.conflicts` is non-empty, return an error report for those paths (`<path> is needed by <neededBy>; it can't be hidden by <owner>`) **before any preflight or mutation**; nothing is written.
- **Owner-only sparse (L1).** A pair with `ownedHere: false` is never assigned `sparse`; if no session/config driver covers it, its row is `no-driver` with `owner` in the reason. Sparse `byProject[P]` only ever contains paths `P` owns.
- **Driver assignment** comes from Task 5's pure `driverFor(tool, artifact, probes)` in `suppression.ts` (the table below is its spec; 11a does not re-derive it), least invasive first:
  - `opencode`: `session` for root/ancestor instruction files and skills. Otherwise, and for nested `AGENTS.md` per P-f, `sparse`.
  - `claude-code`: `claude-config` (11b) for the instruction paths P-e proved. Skills get `claude-config` only if P-e proved `Skill()` deny; otherwise `sparse`.
  - `codex`: `codex-override` for `AGENTS.md` when Task 10 enabled it; otherwise `sparse`.
  - `pi`: `session` after M3; otherwise `sparse`.
  - `cursor`: `sparse`.
  - An artifact that gets `sparse` for any tool is sparse-hidden, and its other pairs are reported `hidden`.
- **`ownership.json`** is **per checkout**, at `<gitDir>/loadouts-state/ownership.json`, because sparse config is per worktree and shared by every project in the checkout:
  ```ts
  { sparse: { byProject: Record<string, string[]>; applied: string | null; pending: string | null } | null,
    claude: Record<string /*projectPath*/, { added: string[]; createdFile: boolean; pending: { added: string[] } | null }> }
  ```
  Each driver records `pending` **before** mutating and promotes it to applied once the postcondition holds. Exclusions for any file a driver will write are set and `verifyIgnored` **before** that write. Recovery data is deleted only after restoration has succeeded. The checkout coordinator covers the entire read-conflict-check-preflight-apply-commit cycle (L8), including explicit session equips; callers holding it must not reacquire it inside the driver.
- **`SuppressionReport`** = `{ rows: {repoPath, tool, state: "session"|"configured"|"hidden"|"present"|"refused"|"no-driver"}[], errors: string[] }`. Any error → the caller exits nonzero.
- **Driver shape** (internal fixed list, no registry): `{ id; preflight(pairs, ctx, own): string[]; apply(pairs, ctx, own): Promise<rows> }`. Export it along with `Ownership`. All preflights run before any apply.
- **Sparse.** The hide set is the union of `byProject`, with patterns `/*` + `!/<gitEscapePattern(p)>` (`/` suffix for dirs). Preflight refuses:
  - `core.sparseCheckoutCone=true`
  - sparse already enabled with `info/sparse-checkout` ≠ the recorded `applied`
  - a newly hidden `p` that is dirty
  - a hidden path that is present and dirty on re-apply
  
  Apply with `git sparse-checkout set --no-cone --stdin` (or `reapply`). Postcondition: every `p` is absent; otherwise the row is `present`. An empty union → `git sparse-checkout disable` **only if** the current config equals the recorded ownership, then `sparse: null`. Linked worktrees get `extensions.worktreeConfig` (expected).
- **Ordering contract** (for 11c): reconcile runs **before** render and compile, so active artifacts are unhidden before their content is read.
Done when: `reconcile.test.ts` covers M2 cases 1–4, two projects sharing one sparse config, refusal to disable on an ownership mismatch, a conflict rejected with zero filesystem/config changes, an ancestor artifact reported `no-driver` instead of sparse-hidden, and a failure injected between the `pending` write and the mutation followed by a successful retry.

### Task 11b — Claude `claudeMdExcludes` driver     wave: 8   risk: low   conviction: high   tier: standard   milestone: no
Goal, per P-e:
- **Positive branch.** For the proven paths, merge `<abs toplevel>/<p>` (in P-e's format) into `<projectRoot>/.claude/settings.local.json` `claudeMdExcludes`. Do the same for `Skill()` deny only if P-e proved it.
  - Preflight refuses a tracked or invalid-JSON settings file.
  - Record `added` and `createdFile`. Removal drops only `added`, and deletes the file only if `createdFile` and it's now `{}`.
  - The file joins this project's owned exclusions.
- **Negative branch.** The driver claims nothing, so 11a assigns `sparse`.
Files: `src/core/reconcile-claude.ts` + test (new), exporting a driver with 11a's shape. 11c registers it; 11b does not edit `reconcile.ts`.
Done when: tests cover merge, preserving user keys and entries, removing only `added`, retaining an enriched Loadouts-created file (still excluded), and whichever branch P-e selected.

### Task 11c — Wiring + report rendering     wave: 9   risk: low   conviction: high   tier: standard   milestone: yes
Files: `src/core/reconcile.ts` (register 11b), `src/cli/commands/{activate,deactivate,render-engine,sync,status}.ts`, `src/tui/core/actions.ts`, `src/core/checkout.ts`.
For activate, deactivate, sync (including early exit), TUI apply, `clear`, recovery and automatic activation, acquire the checkout coordinator **before** reading project selections, live explicit sessions or ownership. Inside it, reread them, compute `planSuppression(ctx, active, requestedTools, await requiredVisibility(git, P))`, reject conflicts, reconcile, render and commit selection/ownership before release. `clear` uses an empty plan; recovery registers the empty-plan restore Task 14 calls. Explicit session equips use this same coordinator and reject requirements incompatible with existing suppression.
- **Conflict rejection.** If the newly computed plan conflicts, print each `<path> is needed by <project|session>; it can't be hidden by <owner>` and exit nonzero before mutation; the checkout and store remain byte-identical. Deactivate is included because shrinking the active set can enlarge the hide set. Do not rely on a check performed outside the coordinator.
- **Sparse effects in activation output.** Before applying, list every path the plan will newly sparse-hide as `⊘ hiding <path> (all harnesses in this checkout)` (also for auto-activation), and `+ restoring <path>` for newly unhidden ones.
- Render report rows into the Task 8 table: `session`/`configured`/`hidden` → `⊘`; `present`/`refused`/`no-driver` → `!`. Propagate errors to a nonzero exit.
Done when: `npm test` passes, including integration tests (tmp repo, `HOME` overridden) for sparse suppression through the real CLI path, nonzero exit propagation from `sync`, a rejected conflicting activation leaving the working tree, `ownership.json` and store bytes unchanged, the `⊘ hiding` lines, and M2 case 14's concurrent parent hide/child activation/session equip race.

### Task 12 — M2 e2e script, docs, MEMORY     wave: 10   risk: low   conviction: high   tier: standard   milestone: yes
Files: `scripts/private-render-e2e.sh` (the M2 block plus cases 1–15, using `scripts/lib/private-fixture.mjs`; cases 9–15 include fallback exposure, cross-project conflicts, concurrent writes, the visibility race and two-worktree recovery as specified in the M2 milestone; case 12 skips with a note if P-j is negative), `docs/runtime.md` (drivers table with fallbacks; sparse affecting every harness in the checkout; `info/exclude` sharing; visibility conflicts; the Claude ≥ 2.1.277 double-read note when there's no tracked `AGENTS.md`), `docs/concepts.md` (private projects, `repo`), and `MEMORY.md`. The MEMORY entry covers: private root in the common dir via a symlink to the store; identity rules; state in `--git-dir`; `repo` from the index; suppression derived, never user-chosen; owner-only sparse + conflict rejection; tracked = index membership; ownership per checkout; cleanup before store removal.
Done when: `npm run build && bash scripts/private-render-e2e.sh` exits 0, the M1 block re-run passes, and `LOADOUTS_E2E_M2=1 node scripts/private-persistence-e2e.mjs` passes (plugin-first catch-up now renders `CLAUDE.local.md`).

### Task 13 — M3 Pi session driver     wave: 11   risk: low   conviction: high   tier: standard   milestone: yes
Goal: in Pi, personal instructions and skills arrive through the session, suppressed instruction sections are stripped, and Pi's suppression pairs move from `sparse` to `session`.
Step 1 (probe, gate): upgrade the **installed** `pi` CLI to 1.3.x. In a scratch `HOME`, dump `before_agent_start` `event.systemPrompt` with a tracked `AGENTS.md` and one ancestor. Record the header format and the skill-advertisement shape in `docs/private-repo-probes.md` (P-g). The orchestrator re-plans step 2 from P-g.
Step 2: `src/tui/hosts/pi/embed-entry.ts:21-40` strips suppressed sections (reusing `stripInstructionBlocks` if P-g matches P-a, else a Pi variant). Change 11a's Pi assignment to `session`, then `npm run build:embedded`.
Done when: a scripted headless Pi turn (`pi -p` against the P-c stub) produces a captured request that contains `ACME_MARKER` and lacks `TEAM_MARKER`, and exits 0.

## Assumptions (defaults taken without asking)

- **Store file shape** is `projects: { <path>: { default, tools } }` (D2 left the shape open). Requested tools are shared across checkouts, like `default`.
- **Store name** defaults to `<org>-<repo>` from `origin`, else `basename(toplevel)`; `--name` overrides it.
- **`file:` remotes count as identity** so local clones (and the tests) work. Other non-network URLs are ignored.
- **Identity is computed only when linking.** Learned IDs therefore accrue at link time, not on every command (the cost of `rev-list --max-parents=0` on monorepos).
- **The plugin auto-activates in `"plugin"` mode** (`ensureCheckout(directory, "plugin")`: state only with `pending: true`, zero working-tree files). File rendering, and sparse for harnesses other than OpenCode, catch up on the next `loadouts` command.
- **A session follows the checkout's active set** unless it has an explicit `/loadouts equip` selection. That's what makes "deactivate → suppressed next turn" work.
- **Claude reads `AGENTS.md` natively** per the product's stance (≥ 2.1.277), even though the installed 2.1.126 doesn't. Assertions that depend on it skip with a note while `claude --version` is below 2.1.277.
- **The new `⊘` indicator** stands for "suppressed".

## Objections (code evidence vs. the brief)

1. **Ownership is per checkout, not per project** (D3 put it in `<proj>/`). Sparse config belongs to the worktree and is shared by every private project in the checkout, so per-project records couldn't safely decide when to disable it. `ownership.json` therefore sits at `<gitDir>/loadouts-state/` and is keyed by project inside.
2. **`repo` must be computed from the index, not import-discovery's disk scan.** `discoverImportableArtifacts` reads the filesystem (`import-discovery.ts:531-560`). After a sparse suppression, the hidden artifact would drop out of `repo`, and the next reconcile would unhide it. Task 3 extracts the template logic and matches it against `git ls-files`, with an equivalence test.
3. **D1 tracked-root sharing needs a new source edge.** `collectContextRoots` only uses `discovered[0]` plus its declared `sources` (`resolve.ts:154-181`), so a same-level tracked root has to be injected as a source explicitly (Task 2).
4. **`requireScopeForName` (`scope.ts:160`) would route global-only names away from the private project.** Decision 13 changes it for private contexts only.
5. **Private instruction delivery for Cursor and Codex needs private targets.** A tracked `AGENTS.md` blocks the shared destination, so Task 10 adds a Cursor always-apply rule and a probe-gated Codex `AGENTS.override.md`; otherwise those cells show `!`.

## Review log

- **2026-10-23, Fable** (sign off with required changes) **and Astra** (don't sign off yet), reviewing the revised design. Both approved Objections 1–4 and 6; Objection 5 is resolved by L5.
  - **Applied:**
    - Ownership-bounded sparse plus a visibility-conflict rejection (L1).
    - `nativeReads` evaluated against the post-suppression filesystem, with `unless`/`overriddenBy` (L2).
    - Per-tool active sets (L3).
    - `readItemSource` as the single content read path, with `composeFor` (L4).
    - The Codex override as a level replacement (L5).
    - `appliedTools`/`pending` plus read-only commands that never write (L6).
    - `preAction` gating, remotes first (L7).
    - `withLock` serialization (L8).
    - M1 split into M1 (real directory) and M1.5 (persistence), with the M2 waves merged (L9).
    - Task 2 split into 2a/2b.
    - Private gitignore routing in Task 6.
    - Recovery-only mode for a dangling link.
    - Port-preserving remote normalization.
    - The `src/core/scope.ts` path fix.
    - Acceptance hygiene (`assertInvisible`), plus the new M1/M1.5/M2 cases.
  - **Applied (2026-10-23, follow-up session):** Task 7 session records, M1 state-only init with Task 14 inserting `ensureCheckout(directory, "plugin")`, retry-safe `ensureSession`; Task 8 tools drift, pending/default notices and sparse-effect lines; Task 9 additive-gating note; Tasks 14–15 for persistence and recovery; Task 10 per-destination modes; Tasks 11a/11c owner-only sparse and conflict rejection; Task 12 e2e; cleanup-before-removal rule. The earlier state/store-only fingerprint shortcut is superseded below.
- **Final consultant review — corrections applied 2026-11-17.** Fable and Astra signed off on the architecture subject to required changes: per-tool classification, checkout-coordinated visibility changes and explicit equips, policy recomputation before the mutation fingerprint, checkout-local applied tools, safe multi-worktree recovery and owner-aware asynchronous locks. Session age alone never authorizes hiding; unverified sessions fail closed. Acceptance cases cover each. These edits have not been sent back for another consultant review.

## Out of scope

- Claude SessionStart / Cursor `workspaceOpen` hooks that run `loadouts sync` (documented follow-on), launcher wrappers, a third Scope, cross-machine sync beyond dotfiles, write-back of edited composed sections, and an OpenCode `tool` hook for nested `AGENTS.md` (unless P-f forces it).
- **Removal requires cleanup first (rule, not a gap).** Removing a private project or deleting a store must be preceded by `loadouts clear --forget` (or `clear`) in every checkout that uses it (Task 14); deleting first leaves outputs, exclude sections and sparse config behind, recoverable only via `clear --private-recover`. Documented in `docs/runtime.md`. A one-shot "delete store everywhere" command is out of scope.
- Separate small fixes: Codex skill mapping `mode: "copy"` (`src/builtins/tools/codex.ts:13`), and `docs/concepts.md` documenting the unimplemented `extends:`.
