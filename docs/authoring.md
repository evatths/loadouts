# Authoring Artifacts

This guide covers creating rules, skills, and instructions. The typical workflow:

1. **Create** an artifact (`loadouts rule add`, `loadouts skill add`, etc.)
2. **Include** it in a loadout (`loadouts add-to <loadout> <artifact>`)
3. **Sync** to render outputs (`loadouts sync`)
4. **Verify** with `loadouts status` or `loadouts info`

---

## Rules

Rules are scoped advisory files with YAML frontmatter:

```markdown
---
description: Go coding standards
paths: ["**/*.go"]
alwaysApply: false
---

# Go Standards

Use errors.Join() for error wrapping.
```

**Frontmatter options:**
- `description` — Brief summary (shown in listings)
- `paths` — Glob patterns for when to apply (e.g., `["**/*.go", "**/*.mod"]`)
- `alwaysApply` — If true, applies regardless of file context

**Create a rule:**
```bash
loadouts rule add api-standards -d "REST API conventions" -p "**/*_handler.go"
```

After creating, add it to a loadout:

```bash
loadouts add-to backend rules/api-standards.md
```

**Import existing:**
```bash
loadouts rule import .cursor/rules/code.mdc --keep
```

---

## Skills

Skills are directories with a `SKILL.md` and optional supporting files:

```
skills/debugging/
├── SKILL.md              # Required: frontmatter + instructions
├── references/           # Optional: supporting documents
│   └── error-codes.md
└── scripts/              # Optional: executable helpers
    └── analyze.sh
```

**SKILL.md format:**
```markdown
---
name: debugging
description: Advanced debugging techniques for Python applications.
---

# Debugging Skill

## When to Use

Invoke this skill when debugging Python errors...

## Instructions

1. Identify the error type
2. Check the stack trace
...
```

**Required frontmatter:**
- `name` — Skill identifier
- `description` — Brief description (this is the "upfront" token cost; full content is lazy-loaded)

**Create a skill:**
```bash
loadouts skill add deploy -d "Deployment procedures"
```

After creating, add it to a loadout:

```bash
loadouts add-to backend skills/deploy
```

---

## Instructions

Per-loadout instruction files live at `.loadouts/instructions/AGENTS.<loadout>.md`. When activated, they render to `AGENTS.md` (or `CLAUDE.md` for Claude Code, which wraps and references `AGENTS.md`).

**Create instructions:**
```bash
loadouts instructions init backend
loadouts instructions edit backend
```

**Import existing:**
```bash
loadouts instructions import                    # Auto-detects AGENTS.md or CLAUDE.md
loadouts instructions import --loadout backend  # Import to specific loadout
```

After creating or importing, run `loadouts sync` to render.

---

## Loadout Definitions

Loadouts are YAML files in `.loadouts/loadouts/`:

```yaml
name: backend
description: Backend development configuration
extends: base

tools:                                  # Optional: override defaults
  - claude-code
  - opencode

include:
  - rules/go.md                         # Simple path
  - skills/deploy                       # Skill directory
  - path: rules/cursor-only.md          # With options
    tools: [cursor]
```

**Per-include tool targeting:**
```bash
loadouts add-to backend rules/cursor-only.md --tools cursor
```

```yaml
include:
  - rules/general.md                    # All tools
  - path: rules/cursor-only.md
    tools: [cursor]
  - path: skills/claude-debug
    tools: [claude-code, pi]
```

---

## OpenCode Config, Commands, And Plugins

OpenCode-specific artifacts live under `.loadouts/opencode/` and only render when included in a loadout that targets `opencode`.

**Whole-file config:**
```jsonc
// .loadouts/opencode/opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-wakatime"]
}
```

Project scope renders this to `opencode.jsonc`. Global scope renders it to `~/.config/opencode/opencode.jsonc`. This is whole-file ownership; if you do not include this artifact, loadouts does not touch your OpenCode config file.

**Slash commands:**
```md
<!-- .loadouts/opencode/commands/loadouts.md -->
# /loadouts

Arguments: `$ARGUMENTS`
```

Project scope renders this to `.opencode/commands/loadouts.md`. Global scope renders it to `~/.config/opencode/commands/loadouts.md`.

**Local plugins:**
```ts
// .loadouts/opencode/plugins/notify.ts
import type { Plugin } from "@opencode-ai/plugin";

export const Notify: Plugin = async ({ $ }) => ({
  "session.idle": async () => {
    await $`osascript -e 'display notification "Session completed" with title "opencode"`;
  },
});
```

Project scope renders this to `.opencode/plugins/notify.ts`. Global scope renders it to `~/.config/opencode/plugins/notify.ts`.

**Include in a loadout:**
```yaml
include:
  - opencode/opencode.jsonc
  - opencode/commands/loadouts.md
  - opencode/plugins/notify.ts
```

NPM plugins belong in the managed `opencode.json(c)` `plugin` array. Local plugin source files belong in `.loadouts/opencode/plugins/`.

---

## Custom Kinds

Define custom artifact types in `.loadouts/kinds/*.yaml`:

```yaml
# .loadouts/kinds/prompt.yaml
id: myteam.prompt
description: Reusable prompt snippets.

detect:
  pathPrefix: prompts/          # Match files in .loadouts/prompts/

layout: file                     # One file → one output

targets:
  claude-code:
    path: "{base}/prompts/{stem}{ext}"
  cursor:
    path: "{base}/prompts/{stem}.mdc"
    ext: .mdc
```

**Path templates:** `{base}`, `{stem}`, `{ext}`, `{name}`

**Detection:** `pathPrefix` or `pathExact`

List all kinds: `loadouts kinds -v`

---

## Token Estimation

`loadouts info` shows token estimates:

- **Upfront** — Loaded at session start (rules, instructions, skill descriptions)
- **Lazy** — Loaded on-demand (full skill content)

Uses ~4 chars/token approximation. Good for comparing loadouts and catching bloat.
