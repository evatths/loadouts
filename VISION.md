# Loadouts Vision

Loadouts makes AI coding agent configuration portable, composable, and task-scoped.

AI coding tools are becoming part of everyday engineering work, but their configuration surfaces are fragmented. Rules, skills, instructions, prompts, extensions, and tool settings live in different locations, use different frontmatter, and are often copied by hand between Claude Code, Cursor, OpenCode, Codex, Pi, and future tools.

Loadouts exists so users can maintain one canonical source of agent configuration, assemble focused bundles for different tasks or collaborators, and apply those bundles safely to the tools they use.

## Product Thesis

AI agent configuration should be managed like source code:

- **Portable:** write once, render correctly for each supported tool.
- **Composable:** assemble task-specific bundles instead of one bloated global config.
- **Inspectable:** see what is active, where it rendered, and how much context it costs.
- **Safe:** never overwrite unmanaged user files or silently discard metadata.
- **Ergonomic:** make the common path simple enough for individual users, teams, and agents.

The long-term goal is not to become a generic dotfile manager. Loadouts should stay focused on agent-facing configuration: instructions, rules, skills, and adjacent artifacts that directly affect agent behavior.

## Core Users

Loadouts serves three core user groups.

| User | Need | Loadouts Value |
|------|------|----------------|
| Multi-tool power user | Uses multiple coding agents and wants consistent config everywhere | Canonical artifacts render to each tool's native format |
| Context optimizer | Wants different context for backend, frontend, review, teaching, debugging, etc. | Named loadouts keep context focused and reduce noise |
| Team lead or platform engineer | Wants shared team standards without forcing one personal setup | Teams can track available artifacts while individuals activate what they need |

These are not separate products. They are different expressions of the same core system: canonical artifacts, named loadouts, safe activation, and tool-specific rendering.

## Core Model

Loadouts has three core operations.

| Operation | Purpose |
|-----------|---------|
| **Resolve** | Compute the active loadout graph and artifact set |
| **Render** | Materialize artifacts into tool-specific filesystem locations |
| **Inject** | Provide artifacts to a live tool session through SDKs or plugins |

Today, Loadouts supports resolve, render, and the first runtime injection foundation. The runtime foundation compiles resolved loadouts into a deterministic `RuntimeBundle` through `loadouts runtime`, but live host-tool session adapters are still integration work.

## Activation Modes

Loadouts should distinguish two activation modes.

| Mode | Mechanism | State | Product Contract |
|------|-----------|-------|------------------|
| Filesystem activation | Link, copy, or generate artifacts into tool config directories | Project/global `.loadouts/.state.json` | Universal baseline |
| Runtime activation | Inject artifacts through a tool SDK, plugin, hook, or TUI integration | Session-local tool/plugin state | Capability-gated per tool |

Filesystem activation is the canonical, reliable baseline. It applies before or between sessions and works wherever a tool reads files from known locations.

Runtime activation is session-local by default. Activating a loadout inside a tool should not mutate `.loadouts/.state.json` or rendered filesystem outputs. A future explicit "persist this runtime loadout" action may bridge runtime and filesystem state, but it is not part of the first runtime activation milestone.

Current implementation status:

- `loadouts runtime [names...]` compiles loadouts without mutating filesystem activation state.
- `--json` emits the resolver-backed `RuntimeBundle` for adapters and plugins.
- `--system-block` emits a model-ready text block for tools that support prompt/system injection.
- Runtime capability flags are explicit per tool, so filesystem-first tools are not presented as native runtime integrations.

## Artifact Scope

Loadouts should focus runtime activation v1 on artifacts that directly affect model behavior.

| Artifact Kind | Filesystem Activation | Runtime Activation v1 |
|---------------|----------------------|------------------------|
| Instructions | Render to `AGENTS.md`, `CLAUDE.md`, or equivalent | Inject through the closest native system/developer instruction surface |
| Rules | Render to tool rule directories | Inject through the closest native rule/context surface |
| Skills | Render to tool skill directories | Prefer native tool discovery; fall back to path discovery |
| Prompts | Render where supported | Out of scope for runtime v1 |
| Extensions | Render where supported | Out of scope for runtime v1 |
| Themes | Render where supported | Out of scope for runtime v1 |

For skills, there are two runtime discovery modes:

- **Native tool discovery:** the integration registers or refreshes skills through the host tool's native mechanism.
- **Path discovery:** the integration injects skill names, descriptions, and source paths so the agent can read the skill manually when native discovery is unavailable.

Runtime integrations should report their actual behavior clearly:

```text
Runtime loadout: backend
Instructions: injected
Rules: injected
Skills: path discovery
Native skill discovery is not available in this tool integration.
```

Loadouts should not market path discovery as native hot-swap. It is a useful fallback, not the full capability.

## Canonical Frontmatter

Loadouts should become a semantic portability layer for artifact metadata.

Canonical artifacts should store Loadouts' portable representation. Tool-native frontmatter should be generated at render time. Known native aliases are sanitized into canonical fields when artifacts are created, imported, or edited.

### Principles

- Canonical frontmatter should be flat and pleasant to write.
- Canonical fields should use kebab-case.
- A field can become canonical when it maps cleanly to at least two major target tools.
- Known equivalent native fields should be normalized into canonical fields.
- Unknown fields should pass through unchanged by default because most tools ignore unknown frontmatter.
- `activate`, `sync`, `status`, and render flows must not mutate source artifacts.
- Authoring and import flows should write canonical frontmatter.

### Rule Frontmatter v1

```yaml
---
description: Go standards
paths: ["**/*.go"]
activation: scoped
---
```

Canonical fields:

| Field | Meaning |
|-------|---------|
| `description` | Human-readable summary and tool routing help where supported |
| `paths` | Portable file/path scope |
| `activation` | `always` or `scoped` |

Inference:

- If `paths` exists, infer `activation: scoped`.
- If `paths` is absent, infer `activation: always`.

`activation: auto` is not part of the portable v1 model. Cursor supports intelligent rule application, but the equivalent behavior is not yet proven across enough target tools. Cursor-specific fields may still pass through if present, but they are not canonical until the concept maps cleanly to at least two major tools.

### Skill Frontmatter v1

```yaml
---
name: debugging
description: Debug Python runtime failures.
user-invocable: true
model-invocable: true
---
```

Canonical fields:

| Field | Meaning |
|-------|---------|
| `name` | Skill identifier |
| `description` | Routing description used to decide when the skill is relevant |
| `user-invocable` | Whether the user can explicitly invoke the skill |
| `model-invocable` | Whether the model may invoke the skill implicitly |

Defaults:

- `user-invocable: true`
- `model-invocable: true`

Known native aliases should sanitize to canonical form. For example, `disable-model-invocation: true` becomes `model-invocable: false`.

### Sanitization Policy

| Operation | Source Mutation |
|-----------|-----------------|
| `rule add`, `skill add` | Writes canonical frontmatter |
| `rule import`, `skill import`, `install` | Converts known native fields to canonical frontmatter |
| `rule edit`, `skill edit` | Sanitizes after the editor exits and prints a concise summary |
| `loadouts sanitize` | Explicitly rewrites existing artifacts to canonical form |
| `loadouts check` | Warns only |
| `activate`, `sync`, `status`, `diff` | Never mutates source artifacts |

Example edit summary:

```text
Sanitized frontmatter:
~ globs -> paths
~ disable-model-invocation -> model-invocable: false
```

## Runtime Integration Strategy

Runtime activation should be progressive and capability-gated. Each integration should declare exactly what it supports.

| Capability | Meaning |
|------------|---------|
| Config switch | Resolve a session-local loadout selection |
| Instruction injection | Inject canonical instructions into the native instruction surface |
| Rule injection | Inject rules into the closest native scoped/advisory surface |
| Native skill discovery | Register or refresh skills as native host-tool capabilities |
| Path discovery | Inject skill names, descriptions, and paths as a fallback |
| Session fork/surgery | Change or branch conversation history |

Recommended tool priority:

1. **Pi:** best proving ground for runtime architecture because it exposes strong session, context, command, and resource-discovery APIs.
2. **OpenCode:** strong plugin and TUI surface, with some experimental context hooks.
3. **Cursor:** high team importance, but requires a dedicated research spike to determine viable integration surfaces.
4. **Claude Code:** high market importance, but likely limited runtime semantics because slash command extension and dynamic skill refresh are uncertain.
5. **Codex:** promising SDK and orchestration model, but lower immediate priority unless its plugin surface stabilizes quickly.

Runtime switching should begin with future-turn behavior. Historical context replacement and session surgery are powerful but fragile and should remain experimental until the basic model is trusted.

## Six-Month Roadmap

The six-month roadmap should build from canonical correctness toward richer authoring and runtime workflows. Each phase should leave the project more useful without requiring later phases to succeed.

### Month 1-2: Canonical Frontmatter and Import Foundation

Goals:

- Define and implement canonical rule and skill frontmatter.
- Sanitize known native aliases into canonical form.
- Ensure authoring, import, install, and edit flows write canonical frontmatter.
- Render canonical fields into each tool's expected native fields.
- Preserve unknown flat frontmatter fields as pass-through data.
- Expand `loadouts check` to report non-canonical or ambiguous frontmatter.

Why this comes first:

- Marketplace imports, runtime activation, compatibility testing, and skill discovery all depend on a trustworthy artifact model.
- This improves existing users immediately without requiring new tool integrations.

### Month 2-3: Universal Artifact Import and Marketplace Installation

Goals:

- Make it easy to adopt existing skills, rules, and instructions from tool directories into `.loadouts/`.
- Support ergonomic installation from common skill marketplaces and filesystem-based installers.
- Normalize imported artifacts into canonical frontmatter.
- Keep provenance lightweight; do not build a full package registry yet.

Product direction:

- Loadouts should be the place installed agent artifacts end up, even if they originated from Claude skills, Cursor rules, OpenCode plugins, local dotfiles, or another installer.
- The user should not need to understand every tool's filesystem conventions to bring artifacts under loadouts management.

Non-goals:

- No hosted registry.
- No dependency solver.
- No trust/sandbox system for arbitrary executable artifact code beyond clear warnings and explicit install behavior.

### Month 3-4: TUI Authoring

Goals:

- Provide a light terminal UI for assembling `loadouts/<name>.yaml` files.
- Make linking and unlinking artifacts to loadouts fast and visible.
- Show artifacts, target tools, token estimates, and conflicts in one place.
- Preserve the CLI as the scriptable source of truth.

Why this matters:

- Loadout assembly is the core authoring workflow.
- A TUI can make composition understandable without requiring users to manually edit YAML every time.
- Teams need a low-friction way to discover available artifacts and assemble focused configurations.

Non-goals:

- No web UI.
- No account system.
- No collaborative editing layer.

### Month 4-6: Runtime Activation Foundations

Status: partially implemented. Core runtime bundle compilation and inspection are in place; live host-tool adapters remain next work.

Goals:

- Introduce an internal injection API parallel to the existing render pipeline. **Done:** `src/core/runtime.ts` compiles deterministic `RuntimeBundle` objects for `instruction`, `rule`, and `skill` artifacts.
- Build a Pi runtime integration first.
- Build or prototype OpenCode runtime integration second. **Started:** `docs/examples/opencode-runtime-plugin.ts` documents an OpenCode-first CLI bridge scaffold using `loadouts runtime --json`.
- Run a Cursor research spike and document feasible integration levels. **Partially done:** runtime capability flags mark Cursor as filesystem-activation only for v1.
- Keep Claude Code on a research/prototype track focused on what can be done honestly.
- Report runtime capability levels clearly per tool. **Done in core bundle:** OpenCode and Codex are `experimental-runtime`, Pi is `native-runtime`, Claude Code and Cursor are `filesystem-activation`.

Runtime v1 success criteria:

- Runtime loadout state is session-local.
- Instructions and rules are injected through the closest native tool surface. **Core support exists; tool adapters still need to apply it.**
- Skills use native tool discovery where supported and path discovery otherwise. **Runtime v1 currently emits path-discovery refs only.**
- Users can see exactly which runtime capabilities are active. **Done via `RuntimeBundle.capabilities` and `loadouts runtime` output.**
- Filesystem activation remains reliable and unchanged. **Maintained:** runtime compile does not write rendered outputs or `.loadouts/.state.json`.

Non-goals:

- No cross-tool promise of native hot-swap.
- No default session-history surgery.
- No mutation of filesystem activation state from runtime activation.

### Ongoing: Reference Docs and Compatibility Testing

These are infrastructure investments that should grow alongside feature work.

Reference docs:

- Maintain local reference notes for supported tool formats, SDKs, frontmatter, discovery paths, and runtime APIs.
- Prefer checked-in summaries and examples over repeatedly fetching online docs during development.
- Use these docs as source material for tests, implementation notes, and agent guidance.

Compatibility testing:

- Build tests that render canonical artifacts for each supported tool and verify the output shape remains compatible.
- Track tool-version-specific behavior where possible.
- Consider an async agent or scheduled job later to check new versions of target tools and report compatibility drift.

This should start small. The first version can be fixture-based render tests and documented compatibility matrices. Full automated tool-version validation can come later.

### Explicitly Out of Scope for the First Six Months

- Hosted loadout registry.
- Organization management, permissions, or accounts.
- Web UI.
- Runtime hot-loading of extensions or themes.
- Cross-tool historical context surgery as a default behavior.
- LoadoutsBench as a product feature.

## LoadoutsBench Research Track

LoadoutsBench is valuable but should not be part of the first six-month product roadmap.

The idea is a lightweight benchmarking system for comparing how effective one loadout is against another on real coding tasks. It may combine deterministic proxy metrics, human scoring, and agentic supervisor review.

Even out of scope, it should influence design in three ways:

- Loadouts should keep artifact provenance clear enough to know which loadout, artifact versions, and rendered outputs were used in a run.
- Runtime activation should be session-local and inspectable so benchmark runs can isolate loadout effects.
- Token accounting should remain tied to resolved/rendered artifacts so benchmarks can compare cost and quality together.

LoadoutsBench should remain a research note until the core product can reliably resolve, render, import, author, and runtime-activate loadouts.

## Long-Term Direction

After the six-month roadmap, Loadouts can expand carefully.

Potential directions:

- Deeper runtime integrations for tools with stable SDKs.
- Shareable loadout packages once artifact import and canonicalization are mature.
- Compatibility automation against new tool releases.
- Policy and trust mechanisms for executable artifact content.
- Benchmarks and evaluation workflows for comparing loadout effectiveness.
- Richer plugin APIs for custom kinds, transforms, validators, and lifecycle hooks.

The guiding constraint should remain the same: prefer features that make agent configuration more portable, focused, inspectable, and safe. Avoid broad platform features that add maintenance burden without improving that core loop.
