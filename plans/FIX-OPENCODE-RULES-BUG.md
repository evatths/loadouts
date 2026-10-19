# OpenCode V2 rule kind is dead output — stop rendering, surface it

## Evidence (reproduced)

- Core source `packages/core/src/config/plugin/instruction.ts` (v2.0.3): instruction candidates are only `join(global.config, "AGENTS.md")` + ancestor walk for `AGENTS.md`. `.opencode/rules/` appears nowhere.
- Live probe (temp project, `opencode run`): AGENTS.md sentinel `SENTINEL-AGENTS-MARKER-MARIGOLD-42` quoted verbatim by the model; `.opencode/rules/sentinel-rule.md` sentinel (with `alwaysApply: true`) invisible.
- Confound: probe machine's global config lists plugin `opencode-rules@latest`, not installed (`opencode plugin list` shows version `-`). Third-party shim, not core — do not depend on it.

**Decision: option (a)** — stop rendering the `rule` kind for opencode, warn + document. Reject (b) fold-into-AGENTS.md: scoped rules (`paths`/`globs`) cannot preserve path-scoping in always-on AGENTS.md, and rules+instruction kinds would become a second writer colliding on the same generated AGENTS.md. Reject (c): probe + source prove rules are not read. Matches existing precedent: Codex and Pi already have "no rule target".

## Changes

1. `src/builtins/tools/opencode.ts`: remove `"rule"` from `supports` and delete the `rule` target block (lines 24–27).
2. `src/builtins/transforms/opencode-rule-frontmatter` (find via grep `opencode-rule-frontmatter`): delete the transform and its tests; it has no remaining consumer.
3. `docs/compatibility.md`: change OpenCode Rule cell to "— (no rule target in OpenCode V2; V1-only concept)". Drop the "Cursor/OpenCode rules" alias bullets (keep Cursor's). Add a Known Limitations line: OpenCode V2 reads only `AGENTS.md` + config `instructions`; rules should be authored as instructions for OpenCode.
4. Migration/back-compat — already paid for by the pipeline, verify only:
   - `applyPlan` (src/core/render.ts:426–440) removes state-file entries whose targetPath is no longer in the plan, then `removeEmptyParentDirs` cleans `.opencode/rules/`. Existing users' stale rule files vanish on next activate/sync.
   - `refreshGitignores` prunes the stale `.opencode/rules/` gitignore entries (MEMORY: gitignore freshness is in the render pipeline).
   - No tombstone/one-off migration code needed. Confirm `import-discovery.ts` won't resurrect orphans (they're deleted before any import runs; unmanaged leftovers would be shadow-import only, acceptable).

## Tests

- `src/builtins/tools/opencode.test.ts` (or nearest existing tool-spec test): planRender of a rule artifact with opencode target produces zero outputs; no `.opencode/rules/` path appears.
- `src/core/render.test.ts`: pre-seed state with a managed `.opencode/rules/old.md` entry, re-apply a plan without that target → file and empty dir removed, gitignore entry pruned (pattern of existing "prunes its stale gitignore entry" test, line 941).
- `check`/`status` follow the Codex/Pi no-rule-target precedent — assert a rule artifact targeting opencode yields the same unsupported-target warning Codex/Pi already produce (locate via grep in `src/cli/commands/check.ts`).

## Verification

1. `npm test` green; `npm run build` then `npm run build:embedded` only if core/render.ts was touched (plan: it isn't).
2. Manual: in a temp project, activate a loadout with `rule` + `instruction` artifacts targeting opencode → warning shown, no `.opencode/rules/`, AGENTS.md renders, `.gitignore` has no rules entry. Re-run the live probe prompt to confirm instruction path still works on 2.0.3.

## Assumptions

- Users who want rules in OpenCode migrate them to `instructions/AGENTS.md` (canonical always-on mechanism); we warn rather than auto-fold.
- Not relying on the third-party `opencode-rules` plugin.
