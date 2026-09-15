# The Loadout Registry: Tracking Session Effectiveness, with Embedded Arena Trials

Status: **Design / RFC** (no implementation yet)
Author: design pass, August–September 2026
Research grounding: Shorehouse Library, `R. Evaluating Personal AI Coding Agent Configurations`

**The registry is the product.** A system for recording and tracking the
effectiveness of AI-assisted work — every session, every day — as loadout
configurations and models change underneath it. Blind paired trials
(**arenas**) are embedded in the flow whenever a comparison deserves causal
certainty; they are the registry's precision instrument, not the system.
Note the structural consequence: the top-level object of optimization is
the interactive main session, and the arena *cannot* pair interactive
sessions (§6.1) — only the registry reaches the headline metric. Build
order follows.

The architecture is a **registry with embedded trials** (the shape
epidemiology settled on decades ago): a continuous observational registry
over the whole population of sessions — main sessions, subagents, nested
orchestrator trees — with randomized comparisons run *inside* it when the
cost of rigor is worth paying. The registry is the base case; the arena is
the scalpel. "Arena" names the highest-validity **protocol** the system
supports, not the system itself.

**Design center: excellent work, less corrective steering, sound judgment,
then greater efficiency.** Quality, time, and cost are the optimization
axes. Main sessions usually succeed eventually because the user steers
them there; the registry must reveal how much the user compensated for the
harness. Appropriate consultation is part of excellent work: changes to
the vision, material new information, and consequential choices with weak
grounds should still come back to the user. Their attention and experience
are first-class outcomes alongside the result.

For routine work, the aim is excellence with little overhead. Demanding
work can justify longer investigation and greater cost when that effort
improves the result. Subagents have a different test: **how good was the
handoff, before the parent repaired it?** Their narrower assignments and
normally unattended execution make direct artifact assessment useful.

Ergonomic capture must produce actionable insight quickly. Large config
deltas may resolve in a handful of blind paired verdicts; smaller ones may
remain unclear at personal volumes. Records and notes are useful either
way. The system's job is to **protect each judgment** and **remember it** —
never to demand sample sizes before the user may act. A lab notebook with
a referee, not a gatekeeper.

---

## 0. The minimum landable system

The first usable system must measure quality and corrective steering as
well as cost. Its pieces are:

1. **Render-time loadout hashing** — `loadouts` records lineage,
   name@version, and rendered hash at activation/render.
2. **Brief references + session records** — link the request or approved
   plan, preserve revisions, and record the session tree and local usage.
   Preserve subagent handoffs before parent edits.
3. **Lightweight main-session review** — “Did it land your vision?” and
   “How much correction did it need?”, with feel and a note available.
   Store these as attributed assessments, separate from recorded facts.
4. **CLI record view** — quality, correction burden, cost/time, and
   experience together, with links back to the work. Handoff assessment
   and comparison views are the next increment (§11).

Hashing, ledger storage, manual capture, and CLI views need no V2 plugin
API. Automatic capture needs probes for review timing, usage extraction,
and handoff preservation (§11). Missing data stays unknown. The manual
`loadouts arena record` escape hatch can record comparisons before arena
automation exists, with their actual validity flags.

Automated steering analysis, worktree arenas, phase profiling, and ranking
models follow once the everyday record helps answer real config questions.

---

## 1. Goals & non-goals

### Goals

- **Record and track the effectiveness of all work** — main sessions,
  dispatched subagents, nested orchestration trees — longitudinally, as
  loadouts and models change. N=1 assessment is the **base case**, not a
  degraded mode; paired trials are the precision instrument layered on top.
- **Main-session effectiveness is the top-level metric** — final quality,
  corrective steering, consultation judgment, total cost/time, and
  experience. Successful completion alone hides the user's rescue work.
  The panel includes attributed judgments and computed facts, never
  collapsed to a scalar (§4).
- **Subagents are assessed at handoff** against their dispatch brief,
  before repair. Quality, usability, blocker reporting, and cost/time to
  handoff stay visible even when the parent later makes the work succeed.
- **Appropriate autonomy:** reduce avoidable correction while preserving
  valuable consultation. Changed requirements are recorded separately;
  fewer user messages is not an objective.
- **Experience is a first-class outcome.** Enjoyment, trust, confidence,
  attentiveness across the working day are terminal outcomes the configs
  directly produce — measured as themselves (§3, honesty rule 6), never as
  proxies for output quality.
- **Config velocity is sacred.** The user edits loadouts constantly;
  measurement must never create pressure to freeze a config. Votes and
  trends pool by **lineage**, not by hash (§6.5), so editing never resets a
  record.
- **Actionable at low n.** Trend lines, matchup records, and one-line notes
  are the primary output; the user acts on a 3–1 record with legible notes.
  Statistics appear only when volume supports them (§8) and never gate
  action.
- **Model is a first-class factor**, not a nuisance variable. First target
  experiment: capability-map which task types each model handles under the
  default loadout.
- **Unified instrumentation.** Briefs, session records, and preserved
  handoffs feed one assessment envelope with distinct main-session,
  handoff, and comparison outputs (§2). Every judgment identifies its
  author, evidence, and time; facts and judgments remain separable.
- **Machinery minimalism.** Every component beyond the spine must earn
  entry against observed behavior (§11). A limited system that runs is
  worth more than a complete system that doesn't.
- Arena protocol: blind, position-randomized, merge-gated paired
  comparison on **new, real tasks**; default **N=2**, up to loadout × model
  matrices for deliberate experiments; winner merges back so real work
  proceeds — embedded in the workstream, not beside it.

### Non-goals (v1)

- Replay/benchmark suites over historical tasks (explicitly rejected: the
  user works forward, not backward).
- Automatic config optimization (GEPA-style loops). The ledger should
  *inform* human config edits; closing the loop automatically is future
  work — and known to regress on holdouts when unsupervised (Stet, May 2026).
- A composite "config score." Quality-per-dollar scalars and weighted
  indices hide exactly the information needed at decision time; the panel
  stays a panel.
- Persistence churn as a headline metric. At personal config velocity,
  churn conflates "the work was bad" with "the project moved." Demoted to
  an on-demand post-hoc analysis tool (§8.5).
- Mid-run steering of arena candidates. The arena measures **pure
  autonomous** performance; that is the estimand, stated up front.
- Deliberately orchestrated dual interactive main sessions. When an
  abort-and-redispatch happens *naturally*, it is recorded as a
  revealed-preference comparison (§2); the system never asks the user to
  interact with two main sessions on purpose.
- Treating sentiment, message counts, or inactivity as ground truth about
  quality, correction burden, trust, or abandonment. Later transcript
  analysis proposes cited, correctable judgments (§4); it does not infer
  the user's private intent as fact.
- Cross-tool support. OpenCode V2 first; the loadouts-side artifacts are
  tool-agnostic by construction.

---

## 2. Architecture: a registry with embedded trials

### Briefs: what work was intended

A **work brief** links the assignment and acceptance criteria to the
original request, dispatch, or approved plan. Expected difficulty is
`routine | demanding | uncertain`; `uncertain` means unknown, not a third
ordered difficulty level. Record it before execution when available, with
who supplied it and when. Do not reconstruct it from how expensive the run
turned out to be.

Start with one brief per main session and one per subagent assignment.
A subagent brief links to the parent's brief; continuations, repairs, and
retries can link to the same work. Arena candidates share the same frozen
brief revision. The brief can be just source references initially — no
mandatory form or separate planning ceremony. Model-written summaries are
proposals, not newly agreed requirements.

When the vision or material requirements change, append a revision with
its source and effective message/time. Earlier decisions are assessed
against what was known then; final quality uses the latest agreed brief
within the reviewed work. Correcting an agent's failure to follow an
existing requirement does not create a new requirement. Source references
are authoritative when a summary is disputed. Multi-task session splitting
is deferred until one brief per session becomes a practical limitation.

### The spine: sessions and preserved handoffs

```
Work brief + revisions
  ├── Sessions and subagent tree
  │     config/model, message refs, artifacts, local usage, timing
  │     └── Preserved handoffs → linked repairs or retries
  └── Assessments
        main-session review | handoff review | arena comparison
```

Every session — main, subagent, nested orchestrator, arena candidate —
uses the same factual record:

- **Provenance:** lineage, loadout name@version, rendered hash, model/build,
  and session tags (§8.4). Capture the configuration actually used, not the
  current configuration when the session is reviewed. Known mid-session
  changes retain their message/time boundaries; mixed runs are labeled.
- **Structure:** parent-session, work/brief revision, and optional
  continuation/retry/repair links. Parentage supports tree views; usage
  accounting follows §4.3, not simple addition of every displayed total.
- **Execution:** message and artifact references, timestamps, local usage,
  test results, commit refs, and merge events. Runtime state is distinct
  from a human judgment that the work is completed or abandoned.
- **Handoffs:** preserve each subagent's returned artifact/report before
  parent edits, with brief revision, session record, message, and time.
  A mutable file path alone is not a snapshot. Later repair is linked to
  this handoff; it never replaces the evidence of the first result.

Facts land independently of review. Assessment can happen immediately or
later, including after a session resumes. Each review targets a recorded
session boundary and specific artifacts; an earlier assessment never
silently becomes a judgment about subsequent work. Append-only revisions
and stable IDs make this possible without copying the whole transcript
into the ledger (§9).

### The assessment object: shared envelope, different review paths

```
assessment
├── arity:     1 | 2 | k
├── protocol:  review | arena | field | revealed
├── review_kind: main | handoff | process | comparison
├── validity:  { paired?, blind?, position_swapped?, interactive? }
├── subjects:  [session-record + brief-revision + artifact/handoff refs, …]
├── author:    user | parent_agent | judge (with model/rubric provenance)
├── recorded_at, evidence_refs, supersedes?
└── outputs:   main review / handoff review / comparison / process findings
```

- **Arity 1, `review`** — the base case, with separate payloads for
  main-session quality/steering/consultation (§4.1), handoff quality and
  usability (§4.2), or later process analysis. Feel is a user report here,
  not a field inferred from the factual session record.
- **Arity 2, `arena`** — the embedded trial: paired, blind,
  position-swapped, merge-gated (§6).
- **Arity k, `field`** — blind field ranking of 3–4 candidates with ties.
- **Arity 2, `revealed`** — naturally occurring implicit votes: the user
  aborts a session and redispatches the same task under a different
  config. Logged as a comparison link with low validity flags; aborting
  one of two attempts mid-stream is a strong signal, but unblinded and
  unpaired-in-inputs, and the record says so.

User, parent, and independent judge assessments are separate records. A
parent accepting a handoff is useful operational feedback, not independent
proof of quality. Corrections append an assessment with `supersedes`;
disagreement between authors stays visible rather than overwriting one
another. Skipped questions and unknown values are distinct from favorable
answers or zero correction.

**Consumption rules — nothing is silently promoted:**

| Analysis | Eats |
|---|---|
| Bradley-Terry rankings (§8.1) | blind, paired, arity ≥ 2 only |
| Main-session trends (§8.0) | main reviews, linked usage, and separately labeled process findings |
| Handoff trends / capability grid | handoff assessments, separated by author and first/repaired result |
| Experience lane | user-reported feel and notes only |

### The two loops

The registry closes the **measurement loop** (config → sessions →
outcomes/experience). A `/reflect`-style integration closes the
**improvement loop** (session → durable learnings → config edits). Wired
together at review time (§5), they form the full cycle: *measure → reflect
→ edit → measure the edit*. When a reflect-produced learning becomes a
loadout edit, the spine records the provenance (`origin: reflect@<session>`)
— so the record view can eventually answer "do my reflection-driven edits
actually move the trend lines?"

---

## 3. Estimands (what the numbers mean)

| Stream | Question answered | Validity claim |
|---|---|---|
| **Main-session trends** | Does this config land the user's vision with less correction, appropriate consultation, and better cost/time? | Observational: the result belongs to a human–agent collaboration. Brief revisions, expected difficulty, task mix, and config/model changes provide context. Before/after trends suggest questions; they do not isolate a config's causal effect. |
| **Subagent handoffs** | How good and usable is the first returned work against its dispatch brief, and what did it cost? | Normally unattended, bounded assignments. Preserve first-handoff evidence and label author and any steering; repaired outcomes are separate. Ordinary handoffs remain observational, even when independently judged. |
| **Arena** | Which (loadout, model) produces better *unattended* work? | Internally valid per comparison (same task, same base commit, blind verdict). Generalizes only to "tasks I chose to arena" while manual mode dominates — the ledger records mode so strata stay separable. |
| **Capability grid** | Which task types can each model handle under a given loadout? | First-handoff usability × task type and expected difficulty. Descriptive; parent acceptance, independent review, and repaired results are distinguished. |
| **Experience** | What is each config like to *live in*? | Self-reported outcome (the patient-reported-outcome model): unblindable by nature and valid as itself; trended with novelty settling windows; never used as evidence of output quality. |

For plan-arenas on side-effectful tasks (§6.3), the estimand is **planning
quality**, not execution quality — stated in the record.

Key statistical honesty rules, baked into the design rather than left to
discipline:

1. **Internal validity comes from pairing**, not from random task
   selection. Arena candidates always receive the identical task, prompt,
   and base commit.
2. **A/A probes** (§8.3) measure the noise floor. Without them, no verdict
   margin is interpretable.
3. **Every run counts.** No discarding bad runs, no silently testing five
   variants and keeping the best (the Leaderboard Illusion at personal
   scale).
4. Vetoes and `off` windows are logged with a one-word reason — selection
   behavior is itself data.
5. **Recording ≠ gating.** The ledger informs; it never blocks a config
   switch or demands more data before the user acts. Statistical readouts
   appear when volume supports them and stay silent otherwise — a blind
   paired verdict on a big-delta comparison is decision-grade on its own.
6. **Experience is an outcome, never a proxy.** Felt-sense gets its own
   first-class lane — structured capture, trend lines, changepoint
   analysis, the same dignity as any metric. It is never used as evidence
   of *output* quality (that comes from explicit artifact/vision assessments
   and verification evidence), and output metrics never overrule experience
   ("the numbers say it's fine" does not beat "I hate working this way").

---

## 4. What gets measured

Two review paths share recorded facts. Quality, time, and cost appear
together; corrective burden, consultation judgment, and experience explain
what it took to get there. Completion is useful context, not a sufficient
quality measure.

### 4.1 Main sessions: the result and the help required

| Dimension | Everyday capture | Later detail |
|---|---|---|
| **Final quality / vision fit** | User: `excellent \| acceptable \| fell_short`, or unknown | Artifact review against the agreed brief, with evidence |
| **Corrective steering** | User: `none \| a_little \| substantial`, or unknown | Cited correction episodes, impact, and repair/retry links |
| **Consultation judgment** | Optional user note or flagged example; otherwise unknown | Useful consultation, unnecessary escalation, and missed consultation, each with evidence |
| **Efficiency** | Total cost and observed timing (§4.3) alongside correction burden | Attributable repair costs and process breakdowns |
| **Experience** | User: `drag \| fine \| flow`, optional note | Optional trust/confidence check-in (§4.4) |

These are lightweight, attributed human judgments, not objective scores or
inputs to the arena ranking model. A user can report an excellent outcome
and substantial correction: preserving that combination is the point.
Work disposition (`completed | abandoned | redone`, or unknown) is recorded
with the review, but never substitutes for vision fit. A resumed or
unfinished session can be reviewed at a checkpoint, with final quality
left unknown until the relevant work is ready.

**Steering classification uses the requirements known at the time:**

| Event | Interpretation |
|---|---|
| User repeats an ignored requirement or rescues an avoidable mistake | Corrective steering |
| Agent surfaces material new information or a consequential choice it cannot confidently resolve | Useful consultation |
| User changes the intended result or scope | Requirement revision, not agent failure |
| Agent asks about a choice already settled or clearly delegated | Potential unnecessary escalation |
| Agent silently commits to a consequential, insufficiently grounded choice | Potential missed consultation |

Autonomous decisions within the brief are expected. “Taken silently” alone
is not a defect, and fewer user messages is not evidence of improvement.
Assess whether consultation was appropriate given materiality, uncertainty,
and delegated authority — not whether the agent claimed to feel confident.

A later process judge proposes episode labels with message references,
the applicable brief revision, rationale, and an `unclear` option. Group
related messages into episodes rather than counting each message as a new
correction. The user can correct labels; intent changes are not reliably
recoverable from a transcript alone. A one-line user note is often better
evidence than a classifier. Do not turn unreviewed episodes into zero events.

### 4.2 Subagents: quality at handoff

Judge the preserved artifact and final report against the dispatch brief:

- **Quality and completeness:** did it fulfill the assignment well?
  Record evidence against the acceptance criteria; use a blind comparative
  vote when an arena is warranted.
- **Usability:** `usable_as_is | needs_repair | needs_replacement`, or
  unknown. This is distinct from excellence: usable work can still admit
  a substantially better solution.
- **Uncertainty and blockers:** did it surface genuine blockers and
  consequential unresolved choices appropriately?
- **Cost/time to handoff:** cost includes its subtree; elapsed time uses
  the handoff boundary, following §4.3.
- **Downstream fate:** accepted, repaired, retried, or discarded, with
  links to the subsequent work and a reason when known.

Preserve each handoff before the parent edits it. First-handoff quality and
the eventual repaired result are separate assessment targets. A repair
inside the parent session can reference a message span; a separate retry
can reference another session. If the repair's cost cannot be isolated,
leave that attribution unknown while retaining the full parent-work cost.
Routine integration is not automatically a repair of a defective handoff.

Parent acceptance is one assessment source; a user or independent judge
provides another. Display them separately. An occasional steered subagent
is labeled with the steering reference and is not treated as unattended
evidence. A subagent orchestrator is itself judged on its delivered work,
even though it may repair its own children's handoffs along the way.

### 4.3 Shared facts: cost, time, diff, and verification

Mechanicals are computed, never LLM-opined: tokens, calls, cost,
timestamps, diff stats, tests/lint where applicable, subagent count, and
tree depth. Rollups follow explicit rules:

- **Cost/tokens:** store local usage with stable source references; sum
  each unique usage event once across the relevant tree and linked
  attempts. Never sum already rolled-up parent totals with child totals,
  or count a replayed/imported usage event again.
- **Failures count:** include unsuccessful, aborted, repaired, and retried
  attempts when showing the cost of reaching the result. First-handoff
  cost remains separately visible. Arena candidate costs and the total
  experimental spend (both candidates plus judging) are distinct views;
  judge spend is measurement overhead, not worker usage.
- **Elapsed time:** measure actual start-to-handoff/review duration for
  the work being shown. Parallel child durations are not added. Across
  linked attempts, distinguish end-to-end elapsed time from the union of
  recorded execution intervals; long gaps can include user or external
  waits. Show known waits separately, and leave missing timing unknown.
- **Human attention:** initially the reported correction burden and
  notes. Message timestamps do not measure minutes spent thinking,
  reading, or reviewing. Any later self-reported duration is labeled as
  such rather than presented as a mechanical.
- **Diff:** files touched and lines added/removed, with base/end refs or
  captured snapshots and an attribution status. Shared working trees and
  unrelated edits can make session attribution unknown. Derive an optional
  `diff_size: S | M | L` band using recorded threshold settings; absent
  evidence is null, not zero. Compute a work's net diff from its endpoints,
  not by summing overlapping parent/child diffs.
- **Verification:** test/lint results reference the artifact version they
  checked. Passing tests is evidence of tested behavior, not proof of
  excellence or complete alignment with the vision.

**Expected difficulty is a separate, pre-execution descriptor (§2).** A
two-line fix may be demanding; a large routine edit may be easy. Diff size
and the phase mix observed afterward do not establish task difficulty and
are not productivity scores or cost denominators. Compare efficiency in
similar work, with quality and burden visible. Greater effort on demanding
work can be the right investment; reduced cost is an improvement only in
the context of the resulting work and the user's preferences.

**Phase profile** (later, §11): a small-model estimate across
`planning/research | implementation | running | debugging | validation`,
stored as a process assessment with model/rubric version, evidence,
coverage, and the chosen unit (turns or token spans). The unit must be
specified before percentages are compared. These are estimates of observed
activity, not measured time or a causal diagnosis. They can suggest why
costs differ; debugging-heavy work is not necessarily worse work. Validate
phase labels and aggregate shares separately before trusting trends (§12).

### 4.4 Experience: self-reported, first-class

`drag | fine | flow` and notes remain available beside quality and burden.
Trust and confidence come from explicit reports, not inferred sentiment or
a decline in questions. Behavioral patterns can prompt a useful question
(“you report more trust but still check constantly”), not settle it.

Skip rate measures capture friction/missingness first, not attentiveness
or trust. Show review coverage with every trend. Mark config changepoints
and initial exposure/novelty windows; those annotations do not eliminate
novelty or task-mix confounding. A monthly two-minute trust/confidence
check-in is an option if feel and notes prove insufficient.

### 4.5 The two effectiveness views

- **Main:** vision fit, corrective burden, consultation findings, total
  cost/time, and experience. “On demanding work, does this config deliver
  excellent results with less correction and appropriate consultation?”
- **Handoff:** quality/completeness, usability, blocker reporting, cost/time
  to first handoff, and linked repair/retry burden. “For this assignment,
  which config returns the strongest usable work fastest and cheapest?”

Filter both by task type and expected difficulty, with unknown visible.
Show individual records, notes, source of judgment, and coverage alongside
summaries. Keep the components together and never collapse them into a
single score. An absence of detected quality difference is not proof of
equal quality; cost/time trade-offs remain the user's decision.

### 4.6 Orchestration: a facet, not a category

Orchestration is a *style of execution* that occurs in any work domain —
you orchestrate a code refactor or a research sweep. It is captured as:

- a boolean session facet (`orchestrated`, auto-detected from whether the
  session dispatched subagents),
- tree views (subagent count, depth, per-subtree cost, and observed elapsed
  intervals under §4.3),
- assessment sub-verdicts (delegation effectiveness, plan quality — §7),
- and lineage matchups between orchestration configs (e.g.
  `orchestration/mine` vs `orchestration/superpowers`), filterable to
  `orchestrated` sessions.

"Which orchestration skill delegates better" is a lineage matchup plus a
facet filter — more data than a dedicated category, same question.

---

## 5. Capture and review

### 5.1 Capture facts as work happens

Link the initial request/dispatch to a brief, record provenance and local
usage, and preserve subagent handoffs as they return. Append known brief
revisions and retry/repair links. This write path does not wait for a
human review or depend on a judge succeeding. Subagents do not each trigger
a user questionnaire.

Capture-on-return must preserve the artifact/report before parent edits;
if a host hook cannot provide that boundary, the dispatch wrapper must
snapshot before releasing the result. CLI/manual snapshot capture is the
fallback. If a first handoff was missed, record it as unavailable rather
than passing off the parent's repaired version as the original.

### 5.2 A short main-session review

Two primary questions, each with a quick choice and skip:

1. **Did it land your vision?** `excellent | acceptable | fell_short`.
2. **How much correction did it need?** `none | a_little | substantial`.

Feel (`drag | fine | flow`), a one-line note, disposition, and a flagged
consultation example are available in the same compact review. All fields
allow unknown; an unfinished session can record burden/feel without a
final-quality judgment. Target a few seconds for the two primary choices,
with the actual burden tested in dogfooding. Do not add an obligatory
questionnaire to every turn or silently default unanswered questions.

**Review timing remains a probe, not an assumed host feature.** The current
runtime notes do not verify a session-close/idle-final hook. Test:

- **Next-session-start:** offer “Review your previous work?” with the
  actual session identified. Opening another session does not imply that
  the earlier one ended or was abandoned; the user can defer or skip.
- **Explicit/sidebar capture:** review at a meaningful checkpoint or when
  the work is ready, including before leaving a long-running session.
- **Close/idle:** use only if the host exposes a useful boundary and
  dogfooding shows that prompting there fits the workflow.

The assessment references the reviewed session record, message boundary,
brief revision, and artifact snapshot. Resuming work produces a new
boundary; corrections to a prior review append a superseding assessment.
Missing and skipped reviews remain visible in coverage figures.

### 5.3 Handoff review and later enrichment

The parent can record acceptance, repair, retry, or discard against a
preserved handoff; user/independent artifact review is separately sourced.
Stage 1 adds these assessments and simple comparison views (§11).

Later background passes can propose steering/consultation episodes, phase
profiles, or `/reflect`-style learnings (memory entries, skill drafts, rule
candidates). Reflect-driven config edits carry `origin: reflect@<session>`
back into the spine. Failed enrichment leaves recorded facts and human
assessments intact, with missing enrichment marked unknown.

Deeper `/review-session` analysis and weekly digests are on-demand until
their findings justify ongoing judge cost. Basic human quality/burden
capture ships in Stage 0; only the detailed automation waits.

---

## 6. The arena protocol

### 6.1 Modes

Factual capture is always-on; reviews are lightweight and skippable. Arena modes:

| Mode | Trigger | Candidate selection | v1? |
|---|---|---|---|
| `manual` | user, from TUI or CLI, typically at subagent-dispatch time | user picks loadouts × models in the picker | **yes — default** |
| `off` | user, optionally with duration (`arena off 4h`) | — | **yes** |
| `auto` | dice roll at configured rate on eligible dispatches | current pick + random challenger | later |
| `shadow` | dice roll; current pick's result merges immediately unreviewed, challenger + observer run in background | pick + challenger | later |

`manual` is expected to dominate. `auto`/`shadow` exist to widen the
sampled task population when the user wants stronger generalization
claims; they are rigor boosters, not prerequisites.

**Scope rule:** the arena covers anything *dispatched* — including an
orchestrator subagent with its own nested subagent tree, which is pairable
natively because it is autonomous from the dispatch point. The one thing
the arena cannot cover is the **interactive main session**: pairing
requires identical inputs, and an interactive session's inputs include the
user — the moment candidate A asks a question and B doesn't, there is no
"same task" anymore, and the user cannot be blinded to a conversation they
are in. Main sessions are assessed by the registry + session review
(arity-1) instead. No mechanism fixes this; it is structural, and the
system is honest about it.

### 6.2 The flow

```
 1. TRIGGER    user dispatches a task via /arena (or intercepted subagent dispatch)
 2. PICK       TUI picker: loadouts (multi-select) × models (multi-select)
               → N candidates; cost estimate shown; task tag auto-suggested
  3. FREEZE     snapshot brief revision, prompt/context + base commit;
                record expected difficulty before results; render each loadout
               into its own worktree under .worktrees/arena/<comparison-id>/<n>/
               (filesystem activation — each worktree is its own OpenCode
               location, so ALL artifact kinds incl. skills bind natively,
               and a nested orchestrator tree inherits the candidate
               loadout wholesale); record loadout hash = hash of rendered
               artifact set
 4. RUN        dispatch identical autonomous sessions (same prompt, same
               params) under a standing instruction: "no user is available —
               surface questions, blockers, and deferred decisions in your
               final report." Collect mechanical metrics from session data;
               mechanicals are NEVER asked of an LLM.
  5. JUDGE      preserve returned artifacts/reports as handoffs, before
                parent edits; shadow observer: blind verdict + sub-verdicts +
               usability flags, logged — deciding nothing in early stages
 6. REVIEW     two-stage verdict flow (§6.4): blind quality vote with costs
               hidden → reveal metrics → all-things-considered pick
 7. MERGE      the ATC pick squash-merged onto the originating worktree with
               trailers (Arena-Id, Loadout-Hash, Model); user proceeds.
               Losers preserved as refs under refs/arena/<comparison-id>/<n>
  8. LEDGER     link brief, session records, handoffs, separate human/judge
                assessments, and merge fate (§9); earlier facts land as captured
```

**The merge is the forcing function.** To get the winner into real work —
which the user needs, it is their actual task — they must pick it blind.
Vote → note → reveal → merge, self-enforcing, no discipline required.
Target: under 60 seconds of flow.

Step 3 is load-bearing: rendering into separate worktrees sidesteps V2's
discovery-time/location-wide skill constraint (see
`docs/opencode-v2-runtime.md` §1, §7.1) *and* exercises loadouts exactly
as filesystem activation does in normal use. No runtime injection is
required for candidates.

Each candidate's review targets its preserved handoff under the shared
brief revision. A later repair in the originating session links back to
that handoff without rewriting its original assessment. Any exceptional
mid-run steering is recorded and makes the run ineligible for an
unattended arena comparison.

The "no user available" instruction makes autonomy calibration *partially*
measurable: the escalation content of the final report (what the candidate
chose to surface vs decide silently) is judged as a sub-verdict (§7). This
is a proxy for interactive escalation behavior, not the thing itself — the
gap is stated, and main-session consultation is assessed from user reports
and later cited process findings (§4.1).

### 6.3 Side-effectful tasks: the plan-arena

Admin-category work (searching Slack, making posts, reservations) produces
side effects in external systems — two candidates cannot both execute.
Plan-arena: candidates run with side-effect tools permission-denied
(read/research tools open), and *propose* actions instead of executing.
The user blind-judges the proposals; the winner executes for real, once.
Pairing preserved, no double-booking. Estimand: planning quality (§3).

### 6.4 The two-stage verdict

Efficiency toward a good outcome is a real preference (a 95% result at 3x
tokens/time can lose to a 94% result at 1x) — but collapsing it into a
quality-per-dollar scalar hides the trade. Instead:

- **Verdict stage 1 — blind quality vote, costs hidden.** The user (and observer)
  judge artifacts with *no cost/time information* so cost anchoring cannot
  contaminate the quality signal. This vote feeds BT.
- **Verdict stage 2 — metrics revealed → all-things-considered pick.** The ATC
  pick is what actually merges. Both votes are recorded; divergences
  ("A was better, B was 3x cheaper, I took B") accumulate into the user's
  *revealed* cost-quality tradeoff — data that eventually answers "how
  much do I actually pay for a quality step" without hard-coding a utility
  function.
- **Keystroke economy: agreement is free.** The ATC pick defaults to the
  blind vote; a single confirm keystroke merges. Overriding takes one
  extra keystroke and gets the note nudge — divergence is the interesting
  datum, so it can afford the friction; agreement cannot. Keeps the <60s
  flow target honest at four logical steps but ~two keystrokes in the
  common case.

### 6.5 Multi-way, lineage, and scope

- N=2 is the default and the primary UX. N up to ~6 (e.g., 3 loadouts ×
  2 models) supported for deliberate experiments.
- **Review modes**, chosen at picker time:
  - `pair` (default): the observer runs position-swapped pairwise rounds
    down to two finalists; the user blind-reviews only the final pair.
    Every observer round is still logged as a pairwise vote, so a 4-way
    arena yields ~3–5 BT observations instead of 1.
  - `field`: the user blind-reviews the full field (up to 3, maybe 4)
    side-by-side and produces a **ranking with ties allowed**
    (e.g., `A > B = C`), positions randomized. Heavier review burden,
    richer vote — used when the user cares enough about the task to see
    every candidate. The observer still runs (verdict logged for κ
    calibration) but the human ranking is authoritative.
- **Additive factor model:** fit Bradley-Terry with
  `strength(candidate) = loadout_effect + model_effect` rather than
  ranking opaque (loadout, model) cells. Per-cell rankings will not
  converge at personal sample sizes (sparse-BT instability); additive
  marginals share strength across every vote. Loadout × model
  *interactions* are recorded in the ledger but not reported until data
  volume permits (~4x what marginals need).
- **Competitor identity = lineage, not hash.** A competitor is a *named
  alternative* (e.g., `orchestration/mine` vs `orchestration/superpowers`),
  stable while its content evolves. Every vote records the exact rendered
  hash for provenance, but records pool by lineage — so constantly editing
  a loadout never resets its record and measurement never pressures the
  user to freeze a config. The user declares a **major-version boundary**
  when a change is big enough that old votes shouldn't count (the plugin
  can warn on a large rendered diff); that starts a fresh record — and a
  changepoint on the trend lines (§8.1) — with the old one archived and
  still queryable.
- **Assessment scope follows loadout scope.** A global loadout's record
  pools across every project and work category it is used in — config
  effects are assumed to transfer until the data says otherwise. A project
  loadout's record pools within its project. Session tags (§8.4) let any
  record be *sliced* by project or category on demand; slicing is
  diagnostic ("does this win hold in shorehouse too?"), never a default
  wall. One layering wrinkle: inside a project the rendered candidate is
  *global loadout ∘ project overlay*, so a comparison records which layer
  varied (`varied_layer` in the ledger) — usually the overlay with global
  held constant, or vice versa.
- **"Current pick," not champion.** In manual-dominant use there is no
  defended champion: the user's current pick per scope (one global, one
  per project where overridden) is a declaration, informed by the record.
  Champion/challenger semantics return only with the deferred
  `auto`/`shadow` modes.

---

## 7. The observer

Two phases with an enforced information boundary; the plugin (not the
observer's goodwill) controls what each phase can see.

**Initial arena observer: the shadow judge.** From Stage 2 (§11) it runs on
every arena and produces verdicts, sub-verdicts, and rationale — but
*decides nothing*. The user votes first (merge-gated, mandatory), then
sees the observer's verdict alongside their own; κ accumulates from day
one at zero validity risk. Trust is earned into authority: κ ≥ 0.7 unlocks
skip-review for routine arenas, and sampling continues forever (judges
drift).

### Phase 1 — blind, produces the score

- Input: frozen brief/acceptance criteria, per-candidate **preserved
  handoff artifact + final report**
  (anonymized as Candidate 1/2), test/lint results. Artifacts: diff for
  code/shorehouse work, report for research, proposed-action plan for
  plan-arenas (where the plan *is* the artifact). **No loadout identity,
  no config content, no cost/time metrics** (§6.4 stage 1), and — by
  design — **no raw trajectory**: trajectories leak identity through skill
  names, model phrasing tells, and system-prompt echoes that position
  swapping cannot fix. Blinding what cannot be redacted is theater; the
  boundary is drawn where redaction is real.
- Output per pair: overall `clear win | narrow win | tie` + blind-safe
  **sub-verdicts** (each `A | B | tie`, never scales): execution quality,
  task adherence, escalation quality (judged from the final report's
  surfaced questions/blockers/deferred decisions) + per-candidate
  **usability flag** (`usable_as_is | needs_repair | needs_replacement`,
  shared with ordinary handoff reviews) + rationale with
  **required citations into the artifact** for every claim + `unknown`
  escape hatch.
- Rubrics are **per-category**: code weighs tests/lint and mergeability;
  shorehouse weighs claim citation, structure, and MOC routing; plan-arena
  weighs feasibility, coverage, and risk surfacing.
- Run **twice with positions swapped**; disagreement between orderings →
  tie.
- Arena quality uses pairwise judgments plus the descriptive usability
  flag, not numeric scales. The user's coarse main-session vision-fit and
  correction-burden reports (§4.1) are a different instrument and never
  converted into pairwise votes.
- **Only the overall verdict feeds BT.** Sub-verdicts are recorded
  diagnostics that make verdict notes richer ("mine won on execution, lost
  on escalation quality").
- Observer model is **pinned and from a different family** than the
  workers where possible (self-preference bias is a perplexity effect — a
  judge sharing the workers' family systematically inflates them).

### Phase 2 — unblinded, diagnostic only

- Input: everything — full trajectories, rendered loadout content,
  per-artifact adherence rubrics (rules → verifiable assertions; skills →
  expected trigger conditions, checked both directions: under- and
  over-triggering), cost/time metrics.
- Output per candidate: **trajectory-derived sub-verdicts** (plan quality,
  delegation effectiveness for orchestrated candidates), grounding counts
  (citations-to-code vs web-fetches per plan), and the adherence report —
  *why* a loadout lost, which rules were violated/ignored, which skills
  fired.
- **Never feeds the score.** Adherence ≠ quality (ETH Zurich: agents
  followed AGENTS.md faithfully while scoring no better at +20% cost).
  Diagnostics explain outcomes; outcomes are the only score.
- For a main session, the **process-review judge** produces cited
  steering/consultation episodes using the applicable brief revisions
  (§4.1). It cannot infer private intent or replace the user's quality and
  burden reports. This automation enters at Stage 2 (§11).
- For an ordinary handoff, an independent artifact review can use the
  brief and preserved output without the trajectory; parent acceptance
  remains separately sourced. This simpler review path enters at Stage 1.

### Placement

- **loadouts ships the definitions:** observer agent definition + rubrics
  as versioned artifacts. The observer's own hash goes in each of its
  assessments — otherwise "loadout B improved" and "the judge drifted" are
  indistinguishable. Per-artifact adherence rubrics are emitted at render
  time by the artifact kinds themselves.
- **The OpenCode plugin/dispatch wrapper ships the integration:** brief
  and session capture, handoff snapshots, worktrees, dispatch, blinding,
  metric extraction, observer invocation, ledger writes, merge trailers,
  and review prompts. Host capabilities are probed before implementation.
- Escape hatch (v2): observer invocable as an external CLI (`codex exec`,
  `gemini`) so the judge's *harness* is also independent of the harness
  being judged.

### Calibration

- In early stages every arena vote is human (merge-gated), so κ
  accumulates for free. Once κ ≥ 0.7, skip-review unlocks and the human
  blind-votes **before** seeing the observer verdict every kth comparison
  (default k=5) forever.
- Calibration is specific to the review task. Agreement on arena artifact
  choices does not establish reliability at interpreting main-session
  corrections or requirement changes. Validate those findings against
  user-labeled examples; unknown intent stays unknown. User and judge
  assessments of the same artifact are linked, not counted as independent
  task trials.

---

## 8. Records & statistics

Reporting is tiered by data volume. Tier 0 is the everyday product; Tier 1
comes online as votes accumulate and is where **subtle effects become
detectable** — the same votes that settled big matchups in days keep
compounding under lineage pooling until 60:40 differences separate from
noise. Nothing in any tier gates action, and no tier requires a dedicated
testing campaign: sensitivity is a byproduct of use.

### 8.0 Tier 0 — trend lines and matchup records (always shown)

- **Main-session view** (§4.5): vision fit, correction burden, consultation
  findings, cost/time, and experience per lineage. Individual records and
  notes are useful from day one; show trends with **declared changepoints**
  (major-version boundaries, model switches), task type, and expected
  difficulty. Before/after comparisons remain observational. User reports
  and judge findings are labeled separately; missing reviews show as
  missing, and superseded reviews do not add observations.
- **Handoff view** (§4.5): quality/completeness, first-handoff usability,
  blocker reporting, cost/time, and linked repair/retry burden. Parent
  acceptance and independent reviews are distinct. First and repaired
  results are separately visible, so a parent fixing weak work does not
  inflate the subagent's first-handoff performance.
- **Whole-work accounting:** linked continuations/retries and descendants
  can be viewed together using §4.3. Show reviewed boundaries and latest
  assessments with coverage; multiple checkpoints on one work item are
  not independent completed tasks. Disposition remains contextual.
- **Matchup records** per lineage pair: **W–L–T record**, dates, task
  tags, verdict notes, and links back to each comparison (artifacts,
  observer rationale, metrics). Example: `orchestration/mine vs
  orchestration/superpowers: 3–1–1, last 2026-09-12` with one-line notes
  per vote. Decision-grade at expected volumes — a legible 3–1 record with
  notes is exactly the "how am I feeling about these two, and why" answer,
  blind-protected and written down. Revealed-preference comparisons
  display in the record with their validity flags visible, never pooled
  into the W–L–T line silently.
- Per-candidate **first-handoff usability × task type/difficulty** (the
  capability grid, §3) also lives at this tier. Each assessed candidate
  contributes regardless of who wins, with author, sample count, and
  unassessed coverage visible. Main-session completion rates do not enter
  this grid as evidence of unattended capability.

### 8.1 Tier 1 — ranking model (appears only at volume)

Shown for a matchup/factor only once it crosses a vote threshold (default:
~15 votes); below that the record view stands alone rather than displaying
an unstable ranking.

- **Custom Bayesian Bradley-Terry, implemented in TypeScript** (~200
  lines: BT is logistic regression on a ±1 design matrix). Weak normal
  priors on factor effects. Chosen over depending on `arena-rank`
  (LMArena's package) after assessment (Sep 2026), because arena-rank
  fails our regime on four counts: (a) competitors are atomic — no
  additive `loadout_effect + model_effect` API (its style-control
  covariates exist only as an example notebook); (b) pure MLE built for
  millions of votes — at personal n, an undefeated loadout causes
  separation (strength → ∞), where a prior yields "strong, wide CI"
  instead; (c) static CIs are not peek-safe, while a posterior can be
  checked daily without inflating false positives — the "statistically
  supported" label (§8.2) is literally `P(A > B | data) ≥ 0.75`; (d) it is
  Python in a TypeScript toolchain.
- **arena-rank's role: validation oracle, not dependency.** Golden tests
  require our implementation to reproduce its ratings/CIs on shared
  pairwise fixtures (priors relaxed, tolerance-bounded). We inherit its
  correctness without its regime mismatch.
- **K-way rankings** (from `field` review mode) use a **Plackett-Luce**
  likelihood on the same factor skeleton (PL is BT's ranking
  generalization). Do NOT decompose a 3-way ranking into three independent
  pairwise votes: the derived pairs are correlated and silently inflate n.
  If decomposition is used as a v1 shortcut, downweight — a k-way ranking
  counts as k−1 effective observations, not k(k−1)/2.
- **Only blind, paired, arity ≥ 2 comparisons of unattended candidates
  enter.** Main-session quality/burden, ordinary handoff reviews, process
  findings, and revealed-preference links inform their respective views,
  never BT. Human and shadow-judge votes on one comparison are linked;
  use the authoritative vote for ranking, not two independent trials.
- Report CIs (posterior intervals) always; point rankings never stand
  alone.

### 8.2 Confidence labels (advisory, never blocking)

- `P(A > B | data) ≥ 0.75` (Cursor's router threshold; configurable) earns
  a matchup a **"statistically supported"** label in the record view. It
  is a display state, not a precondition — the user switches configs
  whenever convinced, and the ledger simply records what the evidence was
  at switch time. Peek-safety comes from the Bayesian posterior (§8.1); no
  separate sequential-testing machinery needed.
- Rule-of-thumb sample sizes surfaced alongside: a 70:30 edge resolves in
  a few dozen paired votes; 55:45 needs hundreds and will realistically
  never resolve at personal scale — **"within noise" is itself
  actionable** (pick the cheaper/faster one, per the mechanicals and the
  two-stage verdict's revealed tradeoff).

### 8.3 A/A probes

- Occasionally the arena silently runs the **same loadout twice**. The
  verdict-margin distribution on A/A runs is the noise floor; if the
  observer (or the user) confidently picks winners in A/A runs, narrow
  verdicts elsewhere get discounted. In manual-dominant usage, the plugin
  occasionally requests an A/A ("calibration run") — user can decline;
  declines are logged. Enters with Stage 2 arenas (§11), before the first narrow
  margin is trusted.

### 8.4 Strata and session tags

- **Hard strata** (never silently pooled): `mode` (`manual|auto|shadow`),
  `protocol` (`arena|field|revealed|review`), and `is_aa_probe`. Reviews also
  distinguish main/handoff/process, author, first/repaired result, and
  steered/unattended execution. Main and handoff outcomes never share a
  generic “success rate.” Headline rankings are computed per eligible
  stratum and combined with explicit labeling.
- **Session tags** (slicing dimensions, pooled by default): every session
  carries `scope` (`global|project`), `project` (when applicable),
  `category`, task type when known, the `orchestrated` facet, and optional
  `diff_size` (`S|M|L`, computed where attribution is available, §4.3).
  Expected difficulty comes from the brief, with source/time and unknown
  retained; it is not derived from the finished diff or phase mix.
  Categories are a fixed, tiny set: `code` (day-to-day software),
  `shorehouse` (research,
  knowledge base, life, reflection), and probably `admin` (task automation
  — searching Slack, making posts, reservations). Multi-valued where work
  genuinely overlaps. Records pool across tags at the loadout's assessment
  scope (§6.5) and can be sliced by any tag — transfer across categories
  is the default assumption, and a sliced record diverging from the pooled
  one is exactly how a transfer failure would surface.
- Start with cwd/loadout-scope tags and existing request/dispatch metadata,
  with quick manual correction. Small-model category/task tagging enters
  at Stage 3 (§11). Retrospective labels are marked as such; do not
  backfill an allegedly pre-execution difficulty judgment after seeing
  the result. Diff size and phase mix are post-run diagnostic slices,
  not substitutes for expected difficulty or task type.

### 8.5 Post-hoc tools (not metrics)

- **Churn analysis**: on-demand ("how much of the arena-merged work from
  lineage X survived?"). Demoted from headline metric: at personal config
  velocity, churn conflates "the work was bad" with "the project moved."
  Useful occasionally as color; never on the panel.

---

## 9. Ledger

Append-only JSONL, global location (`~/.local/share/loadouts/registry/`).
Four row families: `work`, `session`, `handoff`, and `assessment`. They
separate the intended work, recorded execution, preserved output, and
interpretation. This is a small file-backed record system; full transcript
storage and a general-purpose event platform are not required.

Every row has a `schema_version`, unique `record_id`, and `recorded_at`.
Work/session revisions and assessment corrections append with `supersedes`.
Readers select the current revision for a current view; historical reviews
retain their exact record references. Re-importing the same source event
is idempotent. Never sum cumulative session revisions or count corrected
assessments as additional trials. Cross-author disagreement creates a new
assessment, not a superseding correction to someone else's judgment.

Examples are illustrative; referenced child sessions, brief revisions,
and usage events are omitted for brevity. Null means unknown/unavailable,
not zero, failure, or an implied favorable answer.

### Work row: the brief and its revision

```jsonc
{
  "schema_version": 1, "type": "work", "record_id": "work_main:r1",
  "recorded_at": "2026-09-14T10:00:00Z", "supersedes": null,
  "work_id": "work_main", "parent_work_id": null, "revision": 1,
  "source_refs": ["ses_main/msg_request"],
  "acceptance_refs": ["ses_main/msg_approved_plan"],
  "effective_from": { "session_id": "ses_main", "message_id": "msg_approved_plan" },
  "expected_difficulty": {
    "value": "demanding",                  // routine | demanding | uncertain
    "source": "user", "source_ref": "ses_main/msg_request",
    "recorded_at": "2026-09-14T10:00:00Z", "before_execution": true
  },
  "task_type": "refactor", "revision_reason": null
}
```

A later requirement change appends `work_main:r2` with the new source and
effective boundary. A summary added after execution cannot masquerade as
an earlier agreed brief or pre-execution difficulty label.

### Session row: facts local to this session, at a known boundary

```jsonc
{
  "schema_version": 1, "type": "session", "record_id": "ses_main:r1",
  "recorded_at": "2026-09-14T10:20:00Z", "supersedes": null,
  "session_id": "ses_main", "parent_session": null, "role": "main",
  "work_id": "work_main", "brief_revision_refs": ["work_main:r1"],
  "boundary_ref": "ses_main/msg_final",
  "lineage": "default", "loadout": "default@v12", "loadout_hash": "…",
  "model": "…", "model_build": null, "config_changes": [],
  "varied_layer": null,
  "tags": {
    "scope": "project", "project": "loadout", "category": ["code"],
    "orchestrated": true, "diff_size": null
  },
  "mechanicals": {
    "local": { "tokens": 80000, "calls": 20, "cost_usd": 1.20 },
    "usage_source_refs": ["usage_main_1", "usage_main_2"],
    "coverage": "complete",              // local usage through boundary_ref only
    "started_at": "2026-09-14T10:00:00Z",
    "observed_through": "2026-09-14T10:20:00Z",
    "execution_intervals": null, "known_wait_intervals": null,
    "diff": { "base_ref": "…", "end_ref": "…", "stats": null, "attribution": "unknown" },
    "verification_refs": []
  },
  "artifact_refs": ["artifact_final"], "merge_refs": [],
  "links": { "continuation_of": null, "retry_of": null, "repairs_handoff": null },
  "steering_refs": [],
  "origin": null,                        // e.g. reflect@<session>
  "arena": null                          // or comparison_id + candidate index
}
```

Child usage is stored on child records. Tree and whole-work totals are
derived using §4.3, with coverage carried through. Any config/model change
includes its effective boundary; mixed-session aggregates are labeled
rather than attributed entirely to the final model/config.

### Handoff row: immutable evidence before repair

```jsonc
{
  "schema_version": 1, "type": "handoff", "record_id": "handoff_child_1",
  "recorded_at": "2026-09-14T10:10:00Z",
  "session_record_id": "ses_child:r1", "brief_revision_ref": "work_child:r1",
  "sequence": 1, "returned_at": "2026-09-14T10:10:00Z",
  "message_ref": "ses_child/msg_returned", "previous_handoff_ref": null,
  "artifact_snapshot": { "ref": "artifact_child_1", "hash": "…" },
  "report_ref": "report_child_1", "capture_status": "preserved"
}
```

Artifacts/reports are immutable copies or content-addressed refs retained
for review. A hash alone cannot recover an overwritten artifact. Missing
snapshots are explicitly unavailable. Subsequent repairs/retries link from
session records or assessment evidence to this handoff; a later return gets
its own handoff record.

### Assessment rows: same envelope, role-specific outputs

**Main-session user review:**

```jsonc
{
  "schema_version": 1, "type": "assessment", "record_id": "review_main:r1",
  "recorded_at": "2026-09-14T10:21:00Z", "supersedes": null,
  "assessment_id": "review_main", "arity": 1, "protocol": "review", "review_kind": "main",
  "author": { "kind": "user" },
  "validity": { "paired": false, "blind": false, "position_swapped": false, "interactive": true },
  "subjects": [{ "session_record_id": "ses_main:r1", "brief_revision_ref": "work_main:r1", "artifact_ref": "artifact_final" }],
  "evidence_refs": ["ses_main/msg_correction"],
  "outputs": {
    "main": {
      "vision_fit": "excellent", "correction_burden": "substantial",
      "consultation": null, "disposition": "completed",
      "feel": "fine", "note": "Excellent result after I restated the constraint twice."
    }
  },
  "capture": { "skipped_fields": ["consultation"] }
}
```

**Parent handoff review:** an operational judgment, separately sourced from
any independent assessment of the same handoff.

```jsonc
{
  "schema_version": 1, "type": "assessment", "record_id": "review_handoff:r1",
  "recorded_at": "2026-09-14T10:12:00Z", "supersedes": null,
  "assessment_id": "review_handoff", "arity": 1, "protocol": "review", "review_kind": "handoff",
  "author": { "kind": "parent_agent", "session_id": "ses_main", "model": "…", "agent_hash": "…" },
  "validity": { "paired": false, "blind": false, "position_swapped": false, "interactive": false },
  "subjects": [{ "session_record_id": "ses_child:r1", "brief_revision_ref": "work_child:r1", "handoff_ref": "handoff_child_1" }],
  "evidence_refs": ["artifact_child_1", "ses_main/msg_repair"],
  "outputs": {
    "handoff": {
      "quality_findings": ["Missed the backward-compatibility requirement."],
      "usability": "needs_repair", "blocker_reporting": null,
      "downstream_fate": "repaired", "repair_refs": ["ses_main/msg_repair"],
      "attributed_repair_cost_usd": null
    }
  }
}
```

**Human arena comparison:** the shadow judge writes a separate assessment
with the same `comparison_id`, its own model/agent/rubric hashes, evidence,
and outputs. Process analysis is a separate `review_kind: process` record.

```jsonc
{
  "schema_version": 1, "type": "assessment", "record_id": "review_arena:r1",
  "recorded_at": "2026-09-14T11:00:00Z", "supersedes": null,
  "assessment_id": "review_arena", "comparison_id": "arena_1",
  "arity": 2, "protocol": "arena", "review_kind": "comparison", "mode": "manual",
  "author": { "kind": "user" },
  "validity": { "paired": true, "blind": true, "position_swapped": false, "interactive": false },
  "subjects": [
    { "session_record_id": "ses_a:r1", "brief_revision_ref": "work_arena:r1", "handoff_ref": "handoff_a" },
    { "session_record_id": "ses_b:r1", "brief_revision_ref": "work_arena:r1", "handoff_ref": "handoff_b" }
  ],
  "evidence_refs": ["artifact_a", "artifact_b"],
  "task_prompt_hash": "…", "base_commit": "…", "is_aa_probe": false,
  "presentation_order": [1, 0],           // randomized; positions swapped in judge's own assessment
  "outputs": {
    "comparison": {
      "review_mode": "pair", "blind_quality_vote": 0,
      "atc_pick": 1,                     // after reveal; validity.blind applies to quality vote only
      "note": "A was stronger, but B was good enough and much faster.",
      "usability": { "0": "usable_as_is", "1": "usable_as_is" }
    }
  },
  "observer_assessment_ref": "review_observer:r1", "merge_ref": null
}
```

Store blind-vote and reveal timestamps when implementing the arena flow.
Later merge fate appends a linked session revision; it does not mutate a
blind vote. Only the authoritative quality vote enters rankings (§8.1).
Vetoes/off windows remain recorded arena-control metadata with reasons.

Loser refs: `refs/arena/<comparison-id>/<n>` — invisible, free, recoverable
for later "actually B's approach was right" re-votes (recorded as
`revealed` assessments).

---

## 10. TUI surface (OpenCode V2)

Per `docs/tui-architecture.md`, OpenCode gets a thin `@opentui/solid`
skin. The registry + arena adds six flows, in build order (§11):

1. **Main-session review** (§5.2): two quick choices — vision fit and
   correction burden — with feel, note, disposition, and consultation
   example available alongside them. Skip/unknown is explicit. Review
   targets a named work/session checkpoint, offered at the dogfooded
   trigger or opened directly; resumed work is not silently included.
2. **Brief/handoff detail**: links to the original request or dispatch,
   approved plan, expected difficulty, and brief revisions. A subagent
   return opens its preserved artifact/report, with parent acceptance,
   repair/retry links, and independent review shown as separate sources.
   Creating a brief or preserving a handoff requires no form by default.
3. **Record view**: main and handoff views (§4.5, §8.0), filterable by task
   type and expected difficulty. Show quality, burden, time, and cost
   together; distinguish first and repaired handoffs, author, reviewed
   boundary, and coverage. Add matchup W–L–T records and the capability
   grid as comparisons arrive. Intervals/rankings appear only at volume.
   Reuse the shared output conventions (`docs/visual-language.md`);
   unknown and insufficient data are first-class display states.
4. **Picker** (at `/arena` or intercepted dispatch): multi-select
   loadouts, multi-select models, N-permutation preview with cost
   estimate, brief revision and task-tag confirmation, go/veto. Veto
   prompts for a one-word reason.
5. **Status panel** (sidebar): running candidates, elapsed, token burn,
   per-candidate test status. No identities hidden here — blinding applies
   to *artifact review*, not to the fact that an arena is running. On
   *every* session (arena or not), the sidebar also shows the session tags
   (§8.4) with a one-keystroke popup to correct them — the registry's only
   always-on UI. The same popup opens the main-session review at any time
   (§5.2) and links to the current brief and known difficulty source.
6. **Verdict flow**: blind side-by-side artifact review (anonymized,
   position-randomized, **costs hidden**). In `pair` mode: the final pair,
   vote keys (`1`/`2`/`t`). In `field` mode: tabbed/cycled view of up to
   3–4 candidates, rank entry with ties (`1>2=3`). Vote → **one-line note
   prompt** (skippable but nudged) → reveal: identities, observer verdict
   + rationale with citations, metrics table → **all-things-considered
   pick** (defaults to the blind vote — enter merges; overriding takes one
   extra keystroke, §6.4) → merge confirmation.

CLI parity: every flow scriptable (proposed surface:
`loadouts registry log|brief|handoff|review|panel`,
`loadouts arena run|record|status|vote|stats`) per the TUI-is-additive
principle. CLI capture/views land before the host-specific UI. These are
planned commands, not claims of existing functionality.

---

## 11. Staging: build order and entry criteria

The machinery budget is a standing constraint: one maintainer, a beta host
API, and a design whose value depends on the loop *actually closing* every
day. Each stage must prove its premise before the next is built; each
deferred component has a named entry criterion, and components that never
meet their criterion never get built.

### Stage 0 — facts plus main-session quality and burden

Render-time loadout hashing → brief/source references and session records
→ local usage/timing with honest tree rollups → preserved subagent handoffs
→ lightweight main-session quality/burden review → CLI main-session view.
Feel and notes are available from the start. Unknown difficulty or missing
automated extraction does not prevent a record; manual references/capture
can establish the same schema first.

*Proves:* the review habit sticks, source attribution works, and records
distinguish “excellent with little help” from “excellent after rescue.”
Basic quality and correction capture are required here, not deferred until
cost trends look interesting. Coverage/skip rates measure capture burden.

*Entry probes for automatic integration (before committing to a host API):*

1. **Review timing and boundaries:** test next-session-start, explicit
   checkpoint/sidebar capture, and close/idle only if available. Does the
   prompt refer to the intended work, including concurrent/resumed
   sessions? A throwaway probe per `docs/opencode-v2-runtime.md` §8 tests
   the API; dogfooding tests the human burden.
2. **Facts and usage extraction:** inspect real main/subagent session data
   for message IDs, configuration provenance, local usage events,
   timestamps, and parentage. Start with session API inspection, then
   verify message/usage sources and deduplication against known totals.
   Confirm intervals/coverage rather than promising attention measurement
   or deriving wall-clock by summing children. Diff attribution needs its
   own base/end evidence; session metadata alone does not establish it.
3. **Handoff preservation:** can the integration capture the returned
   artifact/report before parent edits? Verify a preserved first handoff
   remains retrievable after the parent repairs it. Use a dispatch wrapper
   or manual snapshot if necessary; mark missed evidence unavailable.

*Unblocked now:* hashing, ledger storage, manual brief/handoff/review
capture, CLI record views, and `arena record` need no V2 plugin API.

*Escape hatch:* `loadouts arena record` accepts **manually-run
comparisons** — the user dispatches two subagents themselves and records a
vote via CLI. Unblinded, low validity flags, honest about both — but it
exercises the schema and starts matchup records (e.g. orchestration/mine
vs superpowers) before Stage 2 arena automation exists.

### Stage 1 — handoff assessments and simple comparisons

Parent acceptance/repair/retry records → user or independent handoff review
→ CLI handoff view and capability grid, with first and repaired outputs
separate. Compare ordinary records by task type and expected difficulty,
with source and coverage visible. They remain observational comparisons.

*Proves:* a parent repairing weak subagent work no longer hides that
weakness, and the records inform a real delegation/model/config choice.

### Stage 2 — targeted process analysis and paired arenas

Two additions can earn entry independently:

- **Steering/consultation analysis:** on-demand judge proposals with
  evidence and user-correctable labels. Enters when coarse burden reports
  raise a recurring question about corrections or consultation. Validate
  against user-labeled episodes and brief revisions before showing rates.
- **Manual paired arena:** enters when a concrete config/model choice
  warrants running the same assignment twice. Uses the existing brief and
  preserved-handoff machinery, N=2, code + shorehouse categories, worktree
  render, identical dispatch, two-stage merge-gated verdict, and a shadow
  observer (§7). A/A calibration is available before trusting narrow wins.

*Proves:* process findings explain actionable sources of corrective burden;
paired comparisons close under real use and improve a specific choice.
Neither addition is required to keep ordinary sessions useful.

### Stage 3 — further earned machinery

| Component | Entry criterion |
|---|---|
| BT posteriors (§8.1) | first matchup crosses ~15 votes |
| Small-model auto-tagging (§8.4) | first wanted slice that cwd-derived tags can't provide |
| Phase profiling (§4.3) | a recurring quality/burden/cost question needs an activity breakdown |
| Plan-arena (§6.3) | first real admin comparison worth running |
| `field` review mode / multi-way | first deliberate experiment needing N>2 |
| Observer skip-review authority | κ ≥ 0.7 sustained |
| `auto`/`shadow` modes | user wants generalization beyond arena-chosen tasks |
| `/reflect` writes provenance to spine | reflection integration is in use and its edits need attribution |
| Weekly digest / scheduled reviews | user asks for the same manual review twice in one week |

---

## 12. Open questions

1. **Task-tag taxonomy** — categories are settled at 2–3 (`code`,
   `shorehouse`, maybe `admin`); still open: the final fixed set of
   *task_tags* within them, and which small model does the auto-tagging
   (cheap local classifier vs one-shot LLM call). Keep expected difficulty
   separate from post-run diff size and phase mix. Which brief-derived
   labels provide useful slices without becoming another form to fill in?
2. **Process and phase-profile reliability** — validate correction,
   useful/unnecessary consultation, missed consultation, and requirement
   revision labels against user-labeled episodes, including ambiguous
   intent. Arena-vote agreement is not calibration for these tasks. For
   phases, settle the unit (token spans vs turns), coverage, and taxonomy
   across categories; assess agreement on span labels and error in
   aggregate shares separately. Validate before promoting outputs to trends.
3. **Novelty settling window** — how long after a changepoint before the
   experience trend counts (fixed days vs session count vs fitted).
4. **Work and repair linking** — when can a continuation/retry/repair be
   linked from explicit dispatch metadata, and when is user confirmation
   needed? How should a parent-session repair span distinguish necessary
   integration from correcting a defective handoff? Uncertain links and
   unisolatable repair costs remain unknown.
5. **Review ergonomics** — do the two primary questions capture vision fit
   and burden well, with feel/note available? Does trust/confidence need a
   monthly explicit check-in? Which review timing works for resumed and
   concurrent sessions without equating inactivity with abandonment?
6. **Ledger format versioning** — location is settled (global; sessions
   cross projects); how rows migrate when the schema evolves.
7. **Observer context budget** — large artifacts may exceed the observer's
   window; chunked review vs file-level sampling vs summary-then-drill.
8. **Merge conflicts on winner pull-back** — the primary worktree may have
   advanced during the arena; rebase policy needed.
9. **Cost governor** — weekly arena budget config; whether multi-way
   arenas draw from a separate deliberate-experiment budget; judge-cost
   governance once automated process reviews exist.
10. **Eligibility rules for auto mode** — subagent-style dispatches only,
    or an explicit `#arena-ok` opt-in? (Deferred with auto mode itself.)
11. **V2 API drift** — §5 and §10 wait on the V2 plugin surface settling;
    re-verify against `docs/opencode-v2-runtime.md` probes before
    implementation.

## 13. Research grounding (selected)

The full evidence base with citations lives in the Shorehouse Library
(`R. Evaluating Personal AI Coding Agent Configurations`). Load-bearing
results for this design:

- Paired same-task comparison ≈ 10x sample efficiency vs between-task A/B
  (interleaving literature; Copilot Arena's in-flow pairing).
- Perception fails **as a proxy**: METR RCT's 40-point believed-vs-measured
  gap motivates measuring time/cost directly rather than inferring them
  from felt productivity. Main-session vision fit and correction burden
  are explicitly user judgments, not measurements of objective speed or
  autonomous quality. Experience follows the patient-reported-outcome model
  (subjective endpoints measured as themselves; honesty rule 6).
- Agent-as-a-Judge: trajectory-grading observer agents reach 90%
  human-consensus agreement (vs 70% for chat-grading); judges need tools,
  calibration, and a different model family (self-preference bias).
- Pairwise > pointwise for selection decisions (~61% vs ~21% signal
  recovery) — why arena selection uses comparative artifact votes and
  `A|B|tie` sub-verdicts. Everyday vision-fit/burden labels describe the
  user's collaboration with the harness; they are not a substitute for
  blind comparative evidence and never enter BT.
- Adherence ≠ quality (ETH Zurich AGENTS.md study) — hence the phase 1 /
  phase 2 information boundary.
- Config effects are large but non-transferable across users (Arize +5–11%
  vs ETH null-to-negative; per-user rankings ρ≈0.04 vs global
  leaderboards) — the reason this system exists at all. Within one user's
  contexts, transfer is the default assumption, subject to tag-sliced
  disconfirmation (§8.4).
- Acceptance tracks perception, not reality (Ziegler et al.) — why
  parent acceptance and completed disposition do not establish excellent
  work. Preserve the first handoff for artifact assessment, and keep later
  repair visible. Churn-based persistence remains a post-hoc tool rather
  than ground truth at personal config velocity.
- Design frames borrowed from clinical research: **registry with embedded
  trials** (observational spine + nested randomized comparisons),
  **interrupted time-series** for N=1 changepoint analysis, and
  **patient-reported outcomes** for the experience lane.
