# Runtime Activation (OpenCode First)

`loadouts runtime` compiles loadouts into a session-time bundle without touching activated outputs on disk. Runtime v1 is designed as an OpenCode-first integration path and a reference surface for other tools.

## Why Runtime Exists

- Keep activation side-effect free for agent sessions.
- Reuse the existing resolver and include semantics from standard loadout compilation.
- Make instruction/rule injection explicit and auditable in one JSON payload.
- Expose skill directories as references (path discovery only), without claiming native skill hot-swap.

## Architecture

Runtime activation follows a resolver-backed bundle compiler:

1. Resolve loadouts exactly like normal activation (`include`, source imports, bundled/global fallback, tool filtering).
2. Compile supported artifacts into a `RuntimeBundle`.
3. Return bundle JSON (`--json`) or a model-ready block (`--system-block`).

Key properties:

- Session-local state: caller owns lifecycle in memory/process state.
- No persistent activation changes: runtime commands do not mutate `.loadouts/.state.json`.
- No output rendering: runtime does not write `.opencode/`, `AGENTS.md`, or other tool target files.
- Deterministic fingerprinting: `fingerprint` is stable across `generatedAt` changes for equivalent content.

## OpenCode-First Flow

Use OpenCode as the primary runtime consumer in v1:

```bash
# JSON bridge for plugin/session adapters
loadouts runtime base backend --tool opencode --json

# Pre-rendered system block text
loadouts runtime base backend --tool opencode --system-block
```

Recommended integration pattern:

- Compile once when a session starts or active runtime loadouts change.
- Cache by `fingerprint`.
- Inject `instructions` and `rules` into model/system context.
- Register `skills[*].path` for discovery only.

## Tool Capability Matrix (Runtime v1)

The bundle always includes resolved instructions, rules, and skill references. Capability flags tell consumers what should be treated as native runtime behavior for each tool.

| Tool | Runtime mode | Instruction/rule model injection | Skill path discovery | Native skill hot-swap |
|------|--------------|----------------------------------|----------------------|-----------------------|
| OpenCode | `experimental-runtime` | Yes | Yes | No |
| Pi | `native-runtime` | Yes | Yes | No |
| Codex | `experimental-runtime` | Yes | Yes | No |
| Claude Code | `filesystem-activation` | No | No | No |
| Cursor | `filesystem-activation` | No (not native) | No | No |

For filesystem-first tools, use standard `activate/sync` as the primary path and treat runtime output as inspection/debugging data.

## Runtime v1 Limits

- Supported kinds: `instruction`, `rule`, `skill`.
- Unsupported kinds are reported as diagnostics, not hard failures.
- Skills require a `SKILL.md` entrypoint for runtime discovery metadata.
- Runtime v1 does not implement native skill hot-swap.

## Reference Scaffold

- Example OpenCode plugin scaffold: `docs/examples/opencode-runtime-plugin.ts`
- Core compiler implementation: `src/core/runtime.ts`
- CLI command surface: `src/cli/commands/runtime.ts`
