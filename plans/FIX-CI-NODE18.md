# Fix red CI: Node 18 becomes a smoke-only leg

## Root cause

`@earendil-works/pi-tui@0.79.7` `dist/utils.js:34-36` builds three `/v`-flag
(unicodeSets) regexes. Node 18 throws `Invalid regular expression flags` when
the module loads. pi-tui declares `engines: ">=22.19.0"`. Only
`src/tui/skins/pi-tui/render.test.ts` and `src/tui/skins/input.test.ts` load
pi-tui at runtime, so only they fail.

## Shipped code is safe on Node 18

pi-tui is loaded at runtime only by `src/tui/hosts/standalone.ts`, reached via
`await import()` in `src/cli/commands/tui.ts` behind `supportsPiTuiNode()`.
`pi/embed-entry.ts` imports it type-only. `list`/`info`/`status` import
`tui/core/data.ts`, which does not touch pi-tui. So `engines: ">=18"` stays.

## Decision

Keep 18 in the matrix as a smoke leg (build, `--help`, `tui` guard). Lint and
the full suite run on 20 and 22. Rejected: bumping engines (cuts off working
Node 18 users), dropping 18 (nothing would check the promise), skipping suites
by Node version (runs pi-tui tests where pi-tui forbids it).

## Changes

- `.github/workflows/ci.yml`: Lint/Test skipped on 18; every leg runs Build and
  `node dist/index.js --help`; the 18 leg also asserts `tui` exits non-zero
  mentioning 22.19.
- `docs/index.md`, `docs/quickstart.md`: note that the `tui` dashboard needs 22.19+.
- No change to `package.json` engines or tsconfig (TypeScript does not rewrite
  regex flags; the failure comes from the dependency).

## Verification

- `npm run lint && npm test && npm run build` on current Node.
- Under Node 18: `node dist/index.js --help` exits 0; `node dist/index.js tui`
  exits 1 and prints the 22.19 message.
- Push a branch, confirm all three CI legs pass, then confirm main is green.

## If the Node 18 build fails

Dev tooling (esbuild, babel) is outside the engines promise. Have the Node 20
leg upload `dist` and the 18 leg download it instead of building.
