# Private repo loadouts — OpenCode first

**Goal.** In a shared Git repo, layer your own loadouts with team guidance from the repo and its subprojects. Turn each layer on or off in OpenCode without changing team files, Git visibility settings, or global loadouts.

**Approach.** Give each directory with supported team config a built-in loadout named after that directory. In `ml-ops/pipelines/data-lens`, `ml-ops`, `pipelines`, and `data-lens` are separate loadouts. `activate caveman` adds your own loadout without dropping any team layers. `deactivate pipelines` turns off just that layer here. Definitions live in your personal store; selections live per project and worktree. Only OpenCode’s sessions change.

**Budget.** Ceiling: 1,600 hand-written lines changed (additions + deletions, including the SDK port, tests, and docs; generated lockfile and embedded bundles reported separately). Stop for a scope decision before exceeding it. The [previous design](archive/PRIVATE-REPO-LOADOUTS-DESIGN.md) is research, not a backlog to implement.

## The workflow to ship

```sh
# From ml-ops/pipelines/data-lens, with opencode-runtime active globally:
loadouts init --private
loadouts create caveman --no-edit
loadouts instructions init caveman              # edit with: loadouts instructions edit caveman
loadouts info pipelines                          # shows that layer and its repo: paths
loadouts add-to caveman instructions/AGENTS.caveman.md repo:pipelines/.opencode/skills/team
loadouts activate caveman                       # keep all three team layers
loadouts deactivate pipelines                   # keep ml-ops, data-lens, caveman; the explicit skill stays
loadouts activate pipelines                     # bring the whole layer back
loadouts clear                                  # drop this project's selection; use native defaults
```

### What a selection means

- **Start with what OpenCode already loads.** No saved selection means normal native behavior. The first `activate` or `deactivate` starts from all visible team bundles, then applies the requested change. After that, names add and remove normally; an explicitly empty selection means all supported team layers are off. `clear` forgets the selection and restores native defaults. Nothing is auto-activated from personal definitions.
- **One team bundle per directory, not one for the whole repo.** `list` shows the applicable bundles from the session directory up to the Git root. Persist their Git-relative IDs (`team:.`, `team:pipelines`, `team:pipelines/data-lens`); accept the directory basename when unambiguous. Nearest personal definitions win; if a team name is ambiguous or shadowed by a personal definition, `list` shows the qualified ID. No aggregate `repo` bundle. `repo:<path>` still selects one artifact; it can keep an item even when its team bundle is off. Honor include-level `tools:` and deduplicate by source. An enabled team bundle preserves the host’s native precedence; it never injects a fallback the host did not load.
- **Support what OpenCode exposes.** Manage attributable ancestor `AGENTS.md`/native `CLAUDE.md` and tracked skills in verified native layouts. Personal instructions, skills, and always-on rules work; explicitly named `.cursor/rules/*.mdc` must have `alwaysApply: true`. Reject unsupported selections with path and reason. Leave agents, commands, plugins, harness configuration, untracked files and global equipment alone. Filtering affects new requests and the skill tool, not prior messages or ordinary file reads. [Guidance discovered later below the session directory](https://opencode.ai/docs/instructions/#discovery) is not part of that session’s team bundles.

## Implementation order

1. **Match the host; prove the session behavior.** Use OpenCode **2.3.2**, `@opencode/*` **^2.3.2** and `@opentui/*` **^0.8.4** per `MEMORY.md`. A disposable upgrade passed lint, build, 295 tests and the restart e2e. Fix the session e2e’s `session.permissions` wait to match the created session ID, not `event.location` (null on this host); update `TESTED_OPENCODE_VERSION`. Use the matching GitHub release executable on scratch `PATH`, not the installed 2.3.0 service.

   A separate **2.3.0** scratch probe confirmed the plugin context can write keyed session instructions and permissions directly. Entries appeared in `event.messages` on the next model step; denied skill IDs still appeared in `event.system`. That probe did **not** prove first-turn timing, native instruction-block removal, or actual skill invocation on 2.3.2.

   Close those gaps in `scripts/opencode-private-e2e.mjs`: reuse the restart fixture pattern, **scratch `HOME` as well as XDG**, dummy credentials and a loopback model. Capture the *first outgoing request* from a nested project; confirm which ancestor instructions and skills the host loads, and that the middle layer can be removed without affecting the others or exposing a fallback. Have the stub call a selected off-disk skill and a suppressed team skill. Use this fixture for final acceptance too. If the host can’t enforce the contract, stop rather than adding a filesystem fallback.

2. **Find the current project by walking to the Git root.** Use the nearest directory with a private definition root, a tracked `.loadouts/` root, or supported tracked native config; fall back to the Git root. Plain subdirectories follow that project. `init --private` enrolls the repo and creates the current directory’s private definition root; an enrolled repo’s nested team projects can toggle layers even without private definitions. To author at a new level, run `init --private` there. Inherit available definitions, **not saved selections**: nearest directory first, private before same-level tracked/read-only, then ordinary sources/global/bundled. Parent, child, and siblings can choose differently.

   `<git-common-dir>/loadouts` links to `~/.config/loadouts/repos/<name>`; store definitions under `<store>/<project-relative-dir>/.loadouts/`. `<absolute-git-dir>/loadouts-state/selection.json` maps Git-relative project directories (`.` for root) to active IDs. Reuse `commands/policy.ts`; serialize and atomically publish changes to this one worktree file after validation. `clear` deletes only the current project’s entry, not its definitions. Use Git’s reported paths. Default a new store to the repo basename; reuse from a fresh clone/fork only via `init --private --name <name>`. Reject unsafe names and conflicting targets. No remote scans, filesystem manifest, composer, gitignore refresh, hooks or `.envrc`. A dangling link never permits writes to the tracked root; report it and let `clear` discard the nearest saved selection without the store.

   Support `create`, `instructions init/edit`, `skill/rule add`, `add-to`/`remove-from`, `list`, `info`, `status`, `activate`/`deactivate`, `sync` and `clear`. In an enrolled repo bare mutations and `-l` mean private **only**; fix both named and bulk scope routing (`clear` and `sync` currently default to all scopes). `sync` validates the current names; it never seeds defaults. `-g` remains global. Reject mixed `--all` mutations and unsupported private writers (including imports, fallback, plain init and TUI file actions) before any write. Read-only/dry runs stay read-only; non-enrolled repos stay unchanged.

3. **Use one catalog for project discovery, inspection and resolution.** Query Git asynchronously for supported pathspecs at ancestor directories (`ls-files --stage -z`, including skill `SKILL.md` entrypoints); don’t scan sibling trees. Attribute each artifact to its containing configuration level, not to every descendant that sees it. Reuse the catalog in `list`, `info`, `commands/loadout-include.ts` and `core/resolve.ts`. The index decides membership; the working file supplies content. Reject missing, unmerged, escaping or ambiguous refs; allow attributable in-repo tracked instruction symlinks. Never copy team sources into the store. Reuse the rule parser and runtime compiler.

4. **Apply the choice in OpenCode.** Reuse `integrations/opencode/{delta,session,advertisement}.ts` and `tui/hosts/opencode/index.ts`. Derive the project from the session’s actual directory. It follows that project’s selection unless explicitly equipped. Keep that distinction across restart in the existing session manifest; `/loadouts unequip` returns to following. All entry points (CLI, plugin, dashboard) use the same policy. Ordinary repos retain existing equip behavior.

   Use the plugin’s own session API through the existing activator/ownership code, not a second client that discovers a service. Refresh before the model request; skip mutations for an unchanged effective selection. Deny calls to suppressed skills **and** filter their advertisement. Refresh selected off-disk skill bodies too; the setup-time `virtual` map alone won’t see new skills. Filter only attributable native blocks; preserve keyed entries and global instructions. If a selected skill collides with a global ID or a required source can no longer be identified, surface the error rather than issue a misleading private turn. No `sessions.json`, live-session scans or visibility locks. `status` reports the checkout’s selection, not proof a plugin delivered it.

After the host proof, CLI/storage and catalog work can proceed in parallel against the layout and include contract above. Integrate once in the host, then finish `docs/runtime.md` with the workflow and boundaries. No separate probe framework or speculative harness adapters.

## Acceptance — exercise the public interfaces

| Proof | Pass condition |
|---|---|
| **Real CLI, real checkout.** Run the workflow above using a fixture editor, with tracked `.loadouts/`, dirty/staged files and an active global loadout. Also try an invalid ref, a dry run, and a refused import. | `list` shows all three team names; `info pipelines` supplies a ref accepted by `add-to`. Index entries/flags, tracked and untracked bytes/symlinks, `git status`, exclude, sparse settings and global outputs match the **pre-step baseline**, not `HEAD`. Invalid activation leaves selection unchanged. |
| **Actual prompts and skills.** Use three levels of native guidance, a middle-level fallback and `team`/`other` skills, a global skill, and tracked `opencode.json`. | First `activate caveman` keeps the three native markers and adds personal guidance once. Turning off `pipelines` removes only the middle marker and `other`; invoking `other` is denied, but the explicitly selected `team` still works. No fallback is newly injected. Test `deactivate pipelines` directly from defaults, an explicit empty selection, and `clear`. A new personal skill appears after `sync`. A separately equipped session is unaffected by `clear`. |
| **Isolation and regressions.** Use root, parent, child, a deeper plain directory, and a linked worktree; restart the service. Include a personal name that shadows a team basename. | Child can use a parent definition without picking up the parent’s selection; toggles don’t change parent or sibling selections. Qualified team name still works. Worktrees share definitions, not selections. Global equipment, foreign entries and denials survive. Run `npm run lint && npm test && npm run build && node scripts/opencode-private-e2e.mjs`, then the existing session/restart e2es against scratch services. |

**Not in this approval:** file delivery to Claude/Cursor/Codex/Pi, sparse checkout, `info/exclude`, or automatic fork enrollment. Each later harness needs its own ancestor-loading proof; OpenCode’s behavior is not a universal rule.
