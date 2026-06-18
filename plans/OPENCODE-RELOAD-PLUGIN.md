# OpenCode `/reload` Plugin Implementation Plan

## Goal

Add a sensibly scoped `/reload` capability for OpenCode users through a bundled, standalone plugin and command artifact.

The plugin should let users refresh OpenCode's startup-loaded configuration surfaces after Loadouts or other tooling writes files, without requiring a full manual quit/restart in the common case.

This is not true in-place hot-swapping of plugin modules. The safe contract is controlled instance reload: finish the current command, dispose or reload the current OpenCode instance through an existing OpenCode lifecycle primitive, then let OpenCode rebuild config, plugins, commands, skills, and related registries.

## Current Facts

- OpenCode local plugins are `*.ts` or `*.js` files in `.opencode/plugins/` or `~/.config/opencode/plugins/`.
- OpenCode plugin files are loaded at startup.
- OpenCode slash commands require command definitions in `.opencode/commands/`, `~/.config/opencode/commands/`, or `opencode.json(c)` `command` entries.
- A plugin alone cannot make a new `/reload` command appear in the TUI command registry after startup.
- OpenCode exposes `POST /instance/dispose` in the server API.
- The TUI runs as a client of an OpenCode server and plugins receive an SDK `client` in their plugin input.
- OpenCode already emits events including `file.watcher.updated`, `session.status`, `session.idle`, `command.executed`, and TUI events.
- Existing Loadouts runtime integration already uses `command.execute.before` to intercept `/loadouts` and `experimental.chat.system.transform` to inject future-turn runtime context.

## Product Contract

`/reload` should mean:

- Re-read OpenCode startup-time configuration surfaces.
- Pick up newly rendered plugin, command, skill, agent, rule, and config files where OpenCode supports them after instance rebuild.
- Preserve workspace files and sessions.
- Avoid mutating Loadouts active state.
- Avoid reloading while a model request or tool execution is active unless explicitly forced.

`/reload` should not promise:

- In-place replacement of one loaded plugin function.
- Native skill hot-swap without OpenCode registry rebuild.
- Retrospective rewriting of previous conversation context.
- Loading a reload plugin that was not already loaded at startup.

## Bundled Artifacts

Add a standalone reload bundle that can be activated independently from the Loadouts runtime bundle.

Recommended files:

- `bundled/opencode/plugins/reload.ts`
- `bundled/opencode/commands/reload.md`
- `bundled/loadouts/opencode-reload.yaml`

Optional later integration:

- Include `opencode-reload` from `opencode-runtime`, or document that users should activate both if they want runtime activation plus reload.

Command artifact behavior:

- Register `/reload` with a concise description.
- Keep body inert, like `bundled/opencode/commands/loadouts.md`.
- Omit `$ARGUMENTS` to reduce model-visible leakage.
- Tell the model not to edit files or infer hidden reload state if the plugin is unavailable.

## User-Facing UX

OpenCode has two related but distinct TUI surfaces:

- Slash/custom commands, registered through `.opencode/commands/*.md` or `opencode.json(c)` `command` entries and run as `/name`.
- The TUI command palette/customization surface, opened with `ctrl+p` by default.

For v1, implement reload as an OpenCode command-registry entry backed by `bundled/opencode/commands/reload.md`. This should make it available wherever OpenCode exposes registered commands, including slash-command completion and any command-list UI backed by the command registry.

Do not assume a plugin can register a native `ctrl+p` palette action. If OpenCode's command palette is backed by a separate TUI action registry, adding `/reload` there requires an upstream/core extension point, not just a plugin file.

Supported commands:

```text
/reload
/reload status
/reload dry-run
/reload now
/reload force
/reload watch on
/reload watch off
/reload help
```

Recommended meanings:

- `/reload` or `/reload now`: schedule a safe instance reload.
- `/reload status`: show whether reload is available, whether a reload is pending, and the last reload attempt result.
- `/reload dry-run`: report what would be reloaded and which file paths are watched/known.
- `/reload force`: reload immediately, even if OpenCode appears busy. This should be documented as potentially disruptive.
- `/reload watch on`: enable debounced auto-reload for config artifacts in this plugin's process.
- `/reload watch off`: disable auto-reload.
- `/reload help`: print command help.

Keep the v1 default conservative: explicit `/reload` only. Auto-watch can be implemented but should be off by default.

## Scope Model

`/reload` should support three internal scopes, even if v1 maps all of them to the same instance-dispose mechanism.

```text
context   Recompute dynamic runtime context only, no instance dispose.
config    Dispose/rebuild OpenCode instance to pick up config, commands, skills, plugins.
all       Same as config in v1; reserved for future broader reloads.
```

Proposed CLI forms:

```text
/reload context
/reload config
/reload all
```

For standalone OpenCode reload, default to `config`. For Loadouts runtime integration, `/loadouts refresh` can remain separate and map to `context` behavior.

## Safety Design

### Reload Boundary

Do not dispose the instance synchronously inside `command.execute.before` before the command response is returned. A synchronous dispose risks tearing down the request currently producing the acknowledgment.

Preferred sequence:

1. Parse `/reload` in `command.execute.before`.
2. Set in-memory `pendingReload` state.
3. Return a short acknowledgment in `output.parts`.
4. Trigger reload after the command handler unwinds using a short timer, or wait for a safe event such as `session.idle`.
5. Call the OpenCode lifecycle primitive.
6. Record success/failure best-effort before the instance disappears.

For v1, use delayed reload:

```text
setTimeout(() => disposeInstance(), 250)
```

For v2, prefer event-driven reload:

```text
pendingReload = true
on event session.idle/session.status idle -> disposeInstance()
```

### Busy Detection

Use available events to keep a coarse busy flag:

- On `session.status` with active/running states, mark busy.
- On `session.idle`, mark idle.
- If status shape is unknown, default to safe delayed reload for explicit `/reload now` and require `/reload force` for immediate reload.

If busy and not forced:

```text
reload: scheduled; will run when the session is idle
```

If forced:

```text
reload: forcing instance reload now
```

### Debounce

For watch mode, debounce file events.

Recommended defaults:

- debounce: `750ms`
- max wait: `5000ms`
- ignore hidden temp files, swap files, and partial writes
- coalesce multiple file changes into one reload

### Re-entrancy Guard

Track:

```ts
type ReloadState = {
  pending: boolean
  running: boolean
  forced: boolean
  watchEnabled: boolean
  lastRequestedAt?: string
  lastAttemptAt?: string
  lastError?: string
}
```

Rules:

- If `running`, do not start a second reload.
- If `pending`, update reason/path list and return existing pending status.
- After lifecycle call begins, expect the plugin process/state to disappear.

## Plugin Implementation Shape

Create a plugin that exports a default OpenCode plugin function.

Inputs needed:

```ts
type PluginInput = {
  client?: unknown
  directory?: string
  worktree?: string
  project?: unknown
}
```

Hooks needed:

```ts
return {
  "command.execute.before": async (input, output) => { ... },
  event: async ({ event }) => { ... },
}
```

Command hook responsibilities:

- Ignore commands other than `reload`.
- Parse arguments with a small tokenizer.
- Update `ReloadState`.
- Mutate `output.parts` with concise deterministic text.
- Schedule reload if requested.

Event hook responsibilities:

- Track idle/busy state.
- Optionally observe `file.watcher.updated` for watch mode.
- If pending reload and idle, trigger reload.

## Calling OpenCode Reload

Preferred adapter order:

1. Use the OpenCode SDK client if it exposes an instance dispose/reload method.
2. Fall back to HTTP `POST /instance/dispose` only if the plugin can discover the active server URL from the client or environment.
3. If neither is available, return a deterministic diagnostic telling the user to restart OpenCode.

Pseudo-interface:

```ts
type ReloadAdapter = {
  available(): Promise<{ ok: boolean; reason?: string }>
  dispose(): Promise<void>
}
```

SDK adapter examples to verify during implementation:

```ts
await client.instance.dispose()
await client.instance.dispose.mutate()
await client.request("POST", "/instance/dispose")
```

Do not hardcode one of these without checking the generated SDK shape in the installed `@opencode-ai/*` package or OpenCode source.

HTTP fallback target:

```http
POST /instance/dispose
```

If auth is configured, rely on the SDK client where possible. Avoid asking users to put server credentials in plugin config for v1.

## Watch Mode

Watch mode can be implemented two ways.

### Preferred: Use OpenCode File Watcher Events

Listen for `file.watcher.updated` events and filter paths.

Candidate watched paths:

- `opencode.json`
- `opencode.jsonc`
- `.opencode/opencode.json`
- `.opencode/opencode.jsonc`
- `.opencode/plugins/**`
- `.opencode/plugin/**`
- `.opencode/commands/**`
- `.opencode/command/**`
- `.opencode/skills/**`
- `.opencode/skill/**`
- `.opencode/agents/**`
- `.opencode/agent/**`
- `AGENTS.md`
- `CLAUDE.md`
- global equivalents under `~/.config/opencode/`

Advantages:

- Avoids creating a second watcher in the plugin.
- Uses OpenCode's existing event stream.

Unknowns:

- Whether `file.watcher.updated` includes global config paths.
- Exact event payload shape.

### Fallback: Plugin-Owned Watcher

Use `fs.watch` or Bun file APIs from the plugin.

Use only if OpenCode events are insufficient.

Risks:

- More platform edge cases.
- Watcher cleanup is hard because plugin lifecycle dispose hooks are not clearly documented.
- Can leak watchers if OpenCode reloads without process cleanup.

Recommendation: avoid plugin-owned watchers in v1.

## Loadouts Integration

The reload plugin should be useful standalone, but Loadouts can bundle and install it.

### New Kind Usage

Reuse existing artifact kinds:

- `opencode-plugin` for `bundled/opencode/plugins/reload.ts`
- `opencode-command` for `bundled/opencode/commands/reload.md`

### New Bundled Loadout

```yaml
name: opencode-reload
description: OpenCode /reload command for refreshing startup-loaded config
include:
  - ../opencode/plugins/reload.ts
  - ../opencode/commands/reload.md
```

Use exact include paths matching the bundled loadout conventions already used by `opencode-runtime.yaml`.

### Optional Composition

Either keep separate:

```bash
loadouts activate opencode-runtime opencode-reload -g
```

Or make `opencode-runtime` include/extend `opencode-reload` once the reload plugin is stable.

Recommendation: separate initially. Runtime activation and OpenCode instance reload are different capabilities and should be independently removable.

## Testing Plan

### Unit Tests

Add tests for a pure reload command module before bundling the self-contained plugin.

Suggested source layout:

- `src/integrations/opencode-reload/command.ts`
- `src/integrations/opencode-reload/plugin.ts`
- `src/integrations/opencode-reload/types.ts`
- `src/integrations/opencode-reload/command.test.ts`
- `src/integrations/opencode-reload/plugin.test.ts`

Test cases:

- Parses empty args as `now` or help/status, depending final UX.
- Parses `status`, `dry-run`, `now`, `force`, `watch on`, `watch off`, `help`.
- Rejects unknown subcommands.
- `command.execute.before` ignores non-`reload` commands.
- `command.execute.before` writes concise `output.parts` for `reload`.
- Adapter unavailable returns diagnostic, not throw.
- Pending reload does not schedule duplicates.
- Busy session schedules instead of immediate reload unless forced.
- Event hook triggers pending reload on idle.

### Render Tests

Add coverage that bundled `opencode-reload` resolves to:

- `.opencode/plugins/reload.ts`
- `.opencode/commands/reload.md`

### Manual Smoke Tests

1. Activate reload bundle globally:
   ```bash
   loadouts activate opencode-reload -g
   ```
2. Restart OpenCode once to load the reload plugin and command.
3. Run `/reload status`.
4. Add or edit a test command in `~/.config/opencode/commands/test-reload.md`.
5. Run `/reload`.
6. Confirm `/test-reload` appears/works without a full manual restart.
7. Edit `~/.config/opencode/plugins/test-reload.ts`.
8. Run `/reload`.
9. Confirm changed plugin behavior loads after instance rebuild.

## Rollout Plan

### Phase 1: Explicit Reload Only

- Add command parser and plugin with `/reload status`, `/reload dry-run`, `/reload now`, `/reload force`, `/reload help`.
- Use SDK client instance dispose if available.
- No watch mode yet, or ship `watch` as disabled/unimplemented diagnostic.
- Bundle plugin + command as `opencode-reload`.
- Document first-run restart requirement.

Acceptance criteria:

- `/reload` command is available after activating bundle and restarting once.
- `/reload status` reports adapter availability.
- `/reload` triggers OpenCode instance dispose/reload through SDK or reports unsupported.
- New command files become available after `/reload` without full manual quit/restart.

### Phase 2: Idle-Aware Scheduling

- Track busy/idle through events.
- Schedule reload on idle by default.
- Keep `/reload force` for immediate reload.

Acceptance criteria:

- If a session is active, `/reload` reports pending.
- When session becomes idle, reload triggers once.
- Duplicate `/reload` requests coalesce.

### Phase 3: Watch Mode

- Implement `/reload watch on/off/status` using OpenCode file watcher events if payloads are sufficient.
- Keep watch mode opt-in.
- Debounce and coalesce path changes.

Acceptance criteria:

- Editing `.opencode/commands/*.md` schedules one reload after debounce.
- Editing `.opencode/plugins/*.ts` schedules one reload after debounce.
- Watch mode can be disabled reliably.

## Failure Modes and Responses

| Failure | Response |
|---|---|
| Plugin not loaded | Command fallback says reload plugin may not be active. |
| Command artifact missing | `/reload` is unavailable; user must activate bundle and restart once. |
| SDK has no reload/dispose method | `/reload status` reports unsupported and suggests restart. |
| Dispose call fails | Report error, keep pending false, record last error. |
| Reload requested while busy | Schedule for idle unless `force`. |
| File event storm | Debounce and coalesce. |
| Plugin reloads itself | Expected; old process/state disappears after dispose. |
| New reload plugin version has a bug | User can start with `OPENCODE_PURE=1` or remove the plugin file from config directory. |

## Documentation Updates

Add or update:

- `docs/runtime.md`: explain `/reload` as OpenCode instance refresh, not runtime context refresh.
- `docs/troubleshooting.md`: add `/reload` checks and first-run restart requirement.
- `docs/commands.md`: add bundled `opencode-reload` loadout and `/reload` UX.
- `VISION.md`: note instance reload as the safe implementation path for OpenCode plugin/command/skill refresh.

## Open Questions

- What exact SDK method maps to `POST /instance/dispose` from inside a plugin?
- Does disposing the instance from a plugin-triggered command cause the TUI to reconnect cleanly in all supported OpenCode clients?
- What is the exact payload shape of `file.watcher.updated` and does it include global config paths?
- What `session.status` values should be treated as busy vs idle?
- Should `opencode-runtime` depend on `opencode-reload`, or should users opt into each bundle separately?

## Recommendation

Implement Phase 1 first as a standalone `opencode-reload` bundle.

Do not attempt in-place plugin hot-swap. Use existing OpenCode instance disposal/rebuild semantics, triggered by an already-loaded reload controller plugin and registered `/reload` command artifact.

Keep watch mode opt-in and defer it until explicit reload is proven reliable in the TUI.
