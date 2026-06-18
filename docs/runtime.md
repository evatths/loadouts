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

### Slash Command UX (`/loadouts`)

The OpenCode runtime path is designed around a deterministic plugin-backed slash command:

```text
/loadouts activate base
/loadouts a base -l
/loadouts a release -g
/loadouts list
/loadouts info base
/loadouts clear
```

Expected behavior:

- The server plugin maps `/loadouts activate|a|use <names...>` to `loadouts runtime ...` (or equivalent runtime adapter path) and computes session runtime state deterministically.
- The TUI plugin listens for server plugin events and renders status/results in a TUI-only dialog that is not appended to chat and is not visible to the assistant.
- `-l/--local` and `-g/--global` are supported as direct scope selectors for runtime compilation.
- Runtime JSON and intermediate plugin outputs stay hidden from the model-facing response.
- The server and TUI plugins share persisted runtime state through `~/.cache/loadouts/opencode-runtime/<cwd-hash>.json`; the server plugin uses that state during system-message injection.
- A bundled scaffold loadout (`opencode-runtime`) renders `.opencode/plugins/loadouts-runtime.ts`, `.opencode/plugins/loadouts-runtime-tui.tsx`, and `.opencode/tui.jsonc`.

### Known OpenCode Runtime Semantics

- The runtime plugin's `command.execute.before` hook is deterministic for parsing `/loadouts` arguments and updating runtime state.
- In interactive OpenCode, the server plugin owns `/loadouts` command handling and the TUI plugin owns user-visible feedback. If the TUI plugin is not loaded, the server plugin remains the headless/fallback path.
- OpenCode may still route server slash command text through model-facing flows when the TUI plugin is absent. Treat user-visible server acknowledgment text as host-dependent.
- OpenCode loads server plugins and TUI plugins at startup. Restart OpenCode after changing or activating runtime plugin or TUI config artifacts.
- The plugin bridge shells out to `loadouts runtime ...`. Ensure the `loadouts` binary available on OpenCode's `PATH` includes runtime support.
- The bundled TUI config is whole-file managed like other Loadouts config artifacts. Existing unmanaged `.opencode/tui.jsonc` files are protected by normal shadowing; add `./plugins/loadouts-runtime-tui.tsx` to your existing TUI config if needed.

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

- Bundled OpenCode server runtime plugin: `bundled/opencode/plugins/loadouts-runtime.ts`
- Bundled OpenCode TUI runtime plugin: `bundled/opencode/plugins/loadouts-runtime-tui.tsx`
- Bundled OpenCode TUI config: `bundled/opencode/tui.jsonc`
- Bundled scaffold loadout: `bundled/loadouts/opencode-runtime.yaml`
- Historical/reference plugin scaffold: `docs/examples/opencode-runtime-plugin.ts`
- Core compiler implementation: `src/core/runtime.ts`
- CLI command surface: `src/cli/commands/runtime.ts`
