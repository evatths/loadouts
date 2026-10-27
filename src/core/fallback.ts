/**
 * Shared fallback script content for loadouts.
 * Used by both init and sync to keep the fallback script up to date.
 */

import * as path from "node:path";
import { writeFile, makeExecutable, ensureDir } from "../lib/fs.js";

export const FALLBACK_SCRIPT = `#!/bin/sh
# Fallback sync for loadouts - applies basic configuration without loadouts installed
# This script is called by git hooks and direnv when loadouts is not available

set -e
cd "$(dirname "$0")/.."

# Skip if already synced (loadouts ran) or fallback already applied
[ -f ".loadouts/.state.json" ] && exit 0
[ -f ".loadouts/.fallback-applied" ] && exit 0

# If loadouts is available, use it
if command -v loadouts >/dev/null 2>&1; then
  echo "loadouts: Applying base configuration..."
  loadouts sync -l
  exit 0
fi

# Fallback: symlink all artifacts without loadouts
echo ""
echo "⚠ This project uses loadouts for AI tool configuration."
echo "  Install with: npm install -g loadouts"
echo ""
echo "  Applying fallback configuration..."

# Instructions — link the first AGENTS.*.md found in .loadouts/instructions/
for instr in .loadouts/instructions/AGENTS.*.md; do
  [ -f "$instr" ] || continue
  # Remove broken symlink from a previous run before re-linking
  if [ -L "AGENTS.md" ] && [ ! -e "AGENTS.md" ]; then rm "AGENTS.md"; fi
  [ -e "AGENTS.md" ] || ln -s "$instr" AGENTS.md
  echo "  ✓ AGENTS.md"
  break
done

# Rules - symlink to all tool directories
for rule in .loadouts/rules/*.md; do
  [ -f "$rule" ] || continue
  stem=$(basename "$rule" .md)
  for tooldir in .claude .cursor .opencode .pi; do
    mkdir -p "$tooldir/rules"
    ext="md"
    [ "$tooldir" = ".cursor" ] && ext="mdc"
    target="$tooldir/rules/$stem.$ext"
    if [ -L "$target" ] && [ ! -e "$target" ]; then rm "$target"; fi
    [ -e "$target" ] || ln -s "../../$rule" "$target"
  done
  echo "  ✓ rules/$stem.md"
done

# Skills - symlink individual files to all tool directories
for skilldir in .loadouts/skills/*/; do
  [ -d "$skilldir" ] || continue
  skillname=$(basename "$skilldir")
  find "$skilldir" -type f | while read -r file; do
    relpath="\${file#$skilldir}"
    for tooldir in .claude .cursor .opencode .agents .pi; do
      targetdir="$tooldir/skills/$skillname/$(dirname "$relpath")"
      mkdir -p "$targetdir"
      target="$tooldir/skills/$skillname/$relpath"
      depth=$(echo "$target" | tr -cd '/' | wc -c)
      updirs=$(printf '../%.0s' $(seq 1 $depth))
      if [ -L "$target" ] && [ ! -e "$target" ]; then rm "$target"; fi
      [ -e "$target" ] || ln -s "\${updirs}$file" "$target"
    done
  done
  echo "  ✓ skills/$skillname"
done

# Mark fallback as complete so we don't run again on every cd
touch .loadouts/.fallback-applied

echo ""
echo "  Run 'loadouts sync' after installing for full configuration."
`;

export const HOOK_SCRIPT = `#!/bin/sh
# Auto-sync loadouts after checkout/clone/merge
exec .loadouts/sync-fallback.sh 2>/dev/null || true
`;

export const ENVRC_LINES = `
# Auto-sync loadouts on directory entry
[ -x .loadouts/sync-fallback.sh ] && .loadouts/sync-fallback.sh
`;

/**
 * Write the main fallback sync script.
 * Works for both git root and subprojects.
 */
export function writeFallbackScript(loadoutPath: string): void {
  writeFile(path.join(loadoutPath, "sync-fallback.sh"), FALLBACK_SCRIPT);
  makeExecutable(path.join(loadoutPath, "sync-fallback.sh"));
}

/**
 * Write git hooks that call the fallback script.
 * Only meaningful when .loadouts/ is at git root.
 */
export function writeGitHooks(loadoutPath: string): void {
  const hooksDir = path.join(loadoutPath, "hooks");
  ensureDir(hooksDir);
  writeFile(path.join(hooksDir, "post-checkout"), HOOK_SCRIPT);
  writeFile(path.join(hooksDir, "post-merge"), HOOK_SCRIPT);
  makeExecutable(path.join(hooksDir, "post-checkout"));
  makeExecutable(path.join(hooksDir, "post-merge"));
}

/**
 * Write all fallback infrastructure (script + hooks).
 * Use writeFallbackScript() alone for subprojects where git hooks don't apply.
 */
export function writeFallbackScripts(loadoutPath: string): void {
  writeFallbackScript(loadoutPath);
  writeGitHooks(loadoutPath);
}
