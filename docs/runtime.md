# Runtime Activation (OpenCode First)

Equip loadouts globally, for a project, or for **one OpenCode session**.
Session switching uses OpenCode V2's durable instruction entries and permission
rules, so another session at the same directory is unaffected.

## CLI

```sh
loadouts session list
loadouts session status --session ses_...
loadouts session equip backend review --session ses_... -p
loadouts session equip caveman --session ses_... -g
loadouts session unequip --session ses_...
```

`-g` and `-p` choose the **loadout source scope**; the destination is always the
named session. Omit `--session` to use the most recently updated root session at
the current directory. `--json` is available on every subcommand.
The CLI discovers an already-running authenticated service; start OpenCode first.

Session equips inject only instruction/rule content not already rendered by
intact Global/Project OpenCode outputs. Skill gates restrict native catalog skill
access to the selected loadout set while retaining pre-existing restrictions.
Unsupported session artifacts (commands, MCP, references, plugins) are reported
as diagnostics; equip those at Global/Project scope.

## OpenCode dashboard

Install the bundled integration at either filesystem scope:

```sh
loadouts activate opencode-runtime -g
# or: loadouts activate opencode-runtime -l
```

This renders the package directory `plugins/loadouts/`, containing the server and
TUI entries. Build from source with `npm run build` before activating a checkout.

Inside OpenCode:

```text
/loadouts                       dashboard (also ctrl+l)
/loadouts equip caveman -g      replace this session's set
/loadouts equip backend -p
/loadouts unequip
/loadouts status
/loadouts list
```

The dashboard shows **G / P / S** equipment and **All / Global / Project**
scope tabs. It opens on **All**. Tabs filter the catalog; in filesystem mode,
each row automatically equips into its own scope. The action target appears in
the detail pane. `m` switches **filesystem ↔ session** when a session is selected;
embedded dashboards open in session mode.

| Keys | Action |
|---|---|
| `j` / `k`, `↓` / `↑` | Move within a section |
| `h` / `l`, `←` / `→`, `Tab` / `Shift+Tab` | Previous / next section |
| `1` / `2` / `3` | Jump to Active / Available / Issues |
| `[` / `]` | Previous / next scope tab |
| `gg` / `G`, `Home` / `End` | First / last row |
| `Space`, `a` / `d` | Toggle, activate / deactivate the selected row |
| `m` | Switch filesystem / session mode |
| `s` / `x` / `D` | Sync / clear / diff the current target |
| `/`, `t` | Search, cycle tool filter |
| `Enter`, `e` | Expand artifacts, edit definition |
| `PgUp` / `PgDn` | Scroll artifact details (or the open overlay) |
| `u`, `r` | Undo last mutation, refresh |
| `?` | Help (`j` / `k` scroll) |
| `Esc` | Close overlay → clear filters → collapse detail → All tab → exit |
| `q` | Exit (or close the current overlay) |

Filesystem bulk operations use the selected tab. In **All**, a scope chooser
asks Global or Project (`h/l` or `j/k`, then `Enter`; `Esc` cancels). Search and
tool filters do not narrow bulk operations. In session mode, bulk actions target
the session's equipped set; a tab for the other source scope has no session
equipment to change. Equipping a session loadout from a different scope replaces
its previous source-scope set, and undo restores that set and scope.

Long sections keep the selected row visible, with row ranges in their headings.
The footer shows contextual shortcuts and updates from persisted session state
and native events.

The server plugin also filters skill advertisements (session permission denies
alone do not hide them on 2.0.3), provides off-disk skills through a catalog
transform, and supports headless equips.

Optional loadout selections:

```yaml
name: review
include:
  - instructions/AGENTS.review.md
opencode:
  agent: reviewer
  model:
    providerID: anthropic
    id: claude-sonnet-4-5
```

For automatic project session equips, add to `.loadouts/loadouts.yaml`:

```yaml
opencode:
  defaultSession: [backend]
```

## Standalone and Pi

`loadouts tui` uses pi-tui and works without OpenCode. If a running service is
available, press `S` to select a conversation at the current directory, then use
session mode. Global/Project activation works independently of the service.
The standalone dashboard requires Node 22.19+.

Pi's bundled `loadouts-runtime` extension uses the same dashboard and layers.
Session equipment is persisted in Pi custom entries, keyed by the actual session
ID, and injected through `before_agent_start`. Resuming/switching a Pi session
reconstructs its own equipment. Pi skills remain path-discovery references.

## Inspect compiled bundles

The existing compiler command remains useful independently of activation:

```sh
loadouts runtime base --tool opencode --json
loadouts runtime base --tool pi --system-block
```

OpenCode supports native per-session instruction entries and skill gating, plus
location-wide skill hot reload. Pi supports session system-prompt injection.
Other tools retain their existing compiler/filesystem capability flags.

See [OpenCode V2 implementation details](opencode-v2-runtime.md) for ownership,
rollback, concurrency limits, cache behavior, probes and verification scripts.
