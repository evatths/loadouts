import * as path from "node:path";
import { realpathSync } from "node:fs";
import { discoverLoadoutRoots, getContext } from "../../core/discovery.js";
import { detectDrift, loadState } from "../../core/manifest.js";
import { loadResolvedLoadouts } from "../../core/resolve.js";
import { compileRuntimeBundle, type RuntimeBundle } from "../../core/runtime.js";
import type { OpenCodeSelection, Scope } from "../../core/types.js";
import { hashContent, isDirectory, isSymlink } from "../../lib/fs.js";

export interface SessionCompilation {
  bundle: RuntimeBundle;
  entries: Record<string, string>;
  skills: string[];
  warnings: string[];
  selection?: OpenCodeSelection;
}

export function entryKey(name: string): string {
  // Keep names readable, but distinguish case, punctuation, and the manifest key.
  return `loadouts.bundle.${name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 60)}-${hashContent(name).replace(/^sha256:/, "").slice(0, 12)}`;
}

export async function compileSession(
  directory: string,
  names: string[],
  options: { scope: Scope; excludeOnDisk?: boolean },
): Promise<SessionCompilation> {
  const ctx = await getContext(options.scope, directory);
  const { loadouts, sourceWarnings } = await loadResolvedLoadouts(ctx, names, { includeBundled: true });
  const full = compileRuntimeBundle("opencode", loadouts);
  const exclude = new Set<string>();
  if (options.excludeOnDisk !== false) {
    // Only exclude intact outputs. A stale manifest or a shadowed/missing file
    // is not evidence that the model has these instructions.
    const rendered = new Set<string>();
    for (const root of await discoverLoadoutRoots(directory)) {
      const state = loadState(root.path);
      if (!state) continue;
      for (const drift of detectDrift(state, path.dirname(root.path))) {
        const target = path.resolve(path.dirname(root.path), drift.entry.targetPath);
        const sameLiveSource = isSymlink(target) && canonical(target) === canonical(drift.entry.sourcePath);
        // V2 natively reads AGENTS.md and skill directories. A managed rule file
        // alone is not proof that an external rule-loader injected its content.
        const native = drift.entry.kind === "skill" || (drift.entry.kind === "instruction" && path.basename(target) === "AGENTS.md");
        if (native && (drift.status === "ok" || sameLiveSource) && drift.entry.tools.includes("opencode")) {
          rendered.add(canonical(drift.entry.sourcePath));
        }
      }
    }
    for (const component of full.components) {
      const entrypoint = component.kind === "skill" && isDirectory(component.sourcePath) ? path.join(component.sourcePath, "SKILL.md") : component.sourcePath;
      if (rendered.has(canonical(component.sourcePath)) || rendered.has(canonical(entrypoint))) exclude.add(path.resolve(component.sourcePath));
    }
  }
  const bundle = compileRuntimeBundle("opencode", loadouts, { exclude });
  const selection: OpenCodeSelection = {};
  for (const loadout of loadouts) Object.assign(selection, loadout.opencode);
  if (Object.keys(selection).length) bundle.fingerprint = hashContent(bundle.fingerprint + JSON.stringify(selection));
  const entries: Record<string, string> = {};
  for (const loadout of bundle.loadouts) {
    const text = [...bundle.injection.instructions, ...bundle.injection.rules]
      .filter((item) => item.loadout === loadout.name)
      .map((item) => `## ${item.relativePath}\n${item.content}`);
    const refs = bundle.injection.skills.filter((skill) => skill.loadout === loadout.name);
    if (refs.length) text.push("## Additional skill entrypoints\n" + refs.map((skill) =>
      `- ${skill.name}${skill.description ? `: ${skill.description}` : ""}\n  Read: ${isDirectory(skill.sourcePath) ? path.join(skill.sourcePath, "SKILL.md") : skill.sourcePath}`,
    ).join("\n"));
    if (text.length) entries[entryKey(loadout.name)] = text.join("\n\n");
  }
  return {
    bundle,
    entries,
    skills: [...new Set(full.injection.skills.map((skill) => skill.name))],
    warnings: [...sourceWarnings, ...bundle.diagnostics.map((item) => item.message + ` (${item.relativePath})`)],
    selection,
  };
}

function canonical(file: string): string {
  try { return realpathSync(file); } catch { return path.resolve(file); }
}
