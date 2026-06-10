---
name: runtime-injection-e2e
description: "Runs a closed-loop OpenCode runtime injection proof using opencode run. This skill should be used when testing /loadouts runtime activation, plugin-injected context, or whether an agent can see a runtime loadout without filesystem activation."
user-invocable: true
model-invocable: true
---

# Runtime Injection E2E

Use this workflow to prove that `/loadouts` runtime activation injects context into a later OpenCode agent turn.

The proof is only valid if the agent returns information that was not in the user prompt and did not come from tools.

## Instructions

1. Create an isolated temp project under `/var/folders/hh/y90cz08d14j4nl2l8nncn7bh0000gn/T/opencode/`.

2. Add a throwaway local loadout with one always-apply rule containing a unique marker.

Use a marker that is impossible to guess, for example `LOADOUT_RUNTIME_E2E_MARKER_<random>_<words>`.

3. Render the runtime plugin into the temp project using the built CLI:

```bash
node /Users/evatt/Desktop/non-cui-repos/loadout/dist/index.js activate opencode-runtime --local
```

4. Add a project `opencode.json` with a primary proof agent that denies tools.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "loadout-proof": {
      "description": "Proof agent with no tool access for runtime injection tests",
      "mode": "primary",
      "permission": {
        "read": "deny",
        "grep": "deny",
        "glob": "deny",
        "bash": "deny",
        "task": "deny",
        "webfetch": "deny",
        "websearch": "deny",
        "edit": "deny",
        "skill": "deny",
        "question": "deny"
      }
    }
  }
}
```

5. Activate the throwaway loadout through the slash command path with `opencode run`:

```bash
opencode run --command loadouts a runtime-secret --format json
```

OpenCode currently reports the plugin's sentinel abort as an `UnknownError`. Treat the run as activated only if the logs or behavior indicate the plugin handled the command. If using `--print-logs`, look for `runtime: activated (...) runtime-secret`.

6. Capture the `sessionID` from the JSON error output.

7. Ask the proof agent for the marker without including the marker in the prompt:

```bash
opencode run --session <sessionID> --agent loadout-proof "What is the runtime injection verification marker? Reply with only the marker. Do not use tools." --format json
```

8. Export the session transcript and verify the answer and absence of tool use:

```bash
opencode export <sessionID>
```

Pass criteria:

- Assistant text equals the unique marker.
- The answer turn has no `tool` parts.
- The prompt did not include the marker.
- The marker is only present in the throwaway rule and the assistant answer.

Fail criteria:

- The assistant uses `grep`, `read`, `bash`, or any other tool to find the marker.
- The assistant returns a placeholder such as `RUNTIME_INJECTION_VERIFIED` instead of the unique marker.
- The follow-up turn has no injected context.

## Important Gotcha

Non-interactive `opencode run` starts a short-lived OpenCode process for each invocation. Runtime plugin state must survive that process boundary for a two-command test loop to pass.

The current Loadouts runtime plugin persists session runtime state under:

```text
~/.cache/loadouts/opencode-runtime/<cwd-hash>.json
```

Clean up the temp project and its cache entry after the proof.

## Useful Commands

Run focused verification after plugin changes:

```bash
npm test -- src/integrations/opencode-runtime/plugin.test.ts
npm run lint
```
