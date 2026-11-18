import * as fs from "node:fs";
import * as path from "node:path";
import type { SkillInfo } from "@opencode/client";
import { compileRuntimeBundle } from "../../core/runtime.js";
import { repoArtifact, resolvePrivateLoadouts, type PrivateProject } from "../../core/private-project.js";
import type { Scope } from "../../core/types.js";
import { parseMarkdownFrontmatter } from "../../core/config.js";
import { hashContent } from "../../lib/fs.js";
import { entryKey } from "./delta.js";

const canonical = (file: string) => { try { return fs.realpathSync(file); } catch { return path.resolve(file); } };
const skillFile = (source: string) => path.join(source, "SKILL.md");

/** Compile only personal content. Team layers retain the host's native winners. */
export function compilePrivate(project: PrivateProject, names: string[], catalog: SkillInfo[], rendered = new Set<string>(), virtualOwned: string[] = [], scope: Scope = "project") {
  const team = new Set<string>();
  const personal: string[] = [];
  for (const name of names) {
    // Saved IDs can outlive the directory that produced them; never reinterpret one as personal.
    if (name.startsWith("team:")) {
      if (project.layers.some((layer) => layer.id === name)) team.add(name);
    } else personal.push(name);
  }
  const loadouts = resolvePrivateLoadouts(project, personal, scope);
  const selectedSources = new Set(loadouts.flatMap((l) => l.items.filter((i) => i.tools.includes("opencode") && i.repoPath).map((i) => canonical(i.sourcePath))));
  const suppress: string[] = [];
  const deny = new Set<string>();
  const nativeSources = new Set(rendered);
  for (const layer of project.layers) {
    if (team.has(layer.id)) for (const item of layer.items) repoArtifact(project, `repo:${item.repoPath}`);
    const instruction = layer.items.filter((item) => item.kind === "instruction");
    // OpenCode selects AGENTS.md before CLAUDE.md, including untracked winners.
    const dir = path.join(project.gitRoot, layer.id.slice(5));
    const winner = ["AGENTS.md", "CLAUDE.md"].map((file) => path.join(dir, file)).find(fs.existsSync);
    const item = instruction.find((entry) => winner && path.resolve(entry.sourcePath) === path.resolve(winner));
    if (item) {
      const source = canonical(item.sourcePath);
      nativeSources.add(source);
      if (!team.has(layer.id) && !selectedSources.has(source)) suppress.push(item.sourcePath);
    }
    for (const skill of layer.items.filter((entry) => entry.kind === "skill")) {
      const source = canonical(skill.sourcePath);
      const live = catalog.find((entry) => !virtualOwned.includes(entry.id) && canonical(entry.path) === canonical(skillFile(skill.sourcePath)));
      if (!live) continue;
      nativeSources.add(source);
      if (!team.has(layer.id) && !selectedSources.has(source)) deny.add(live.id);
    }
  }
  const exclude = new Set(loadouts.flatMap((l) => l.items.filter((i) => nativeSources.has(canonical(i.sourcePath)) || (i.kind === "skill" && nativeSources.has(canonical(skillFile(i.sourcePath))))).map((i) => path.resolve(i.sourcePath))));
  const bundle = compileRuntimeBundle("opencode", loadouts, { exclude });
  if (bundle.diagnostics.length) throw new Error(bundle.diagnostics.map((d) => `${d.message} (${d.relativePath})`).join("\n"));
  const virtual = bundle.injection.skills.map((skill) => {
    const file = skillFile(skill.sourcePath), id = path.basename(skill.path);
    const parsed = parseMarkdownFrontmatter(fs.readFileSync(file, "utf8"));
    const live = catalog.find((entry) => entry.id === id);
    if (live && canonical(live.path) !== canonical(file)) throw new Error(`Skill ${id} collides with ${live.path}; cannot equip ${file}.`);
    return { id, name: typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : id, description: skill.description ?? "", path: file, content: parsed.body };
  });
  const ids = new Map<string, string>();
  for (const skill of virtual) {
    const previous = ids.get(skill.id);
    if (previous && canonical(previous) !== canonical(skill.path)) throw new Error(`Skill ${skill.id} has conflicting sources: ${previous} and ${skill.path}.`);
    ids.set(skill.id, skill.path);
  }
  const entries: Record<string, string> = {};
  for (const loadout of bundle.loadouts) {
    const text = [...bundle.injection.instructions, ...bundle.injection.rules].filter((item) => item.loadout === loadout.name).map((item) => `## ${item.relativePath}\n${item.content}`);
    if (text.length) entries[entryKey(loadout.name)] = text.join("\n\n");
  }
  return { entries, virtual, suppress, deny: [...deny], fingerprint: hashContent(JSON.stringify({ entries, virtual, suppress, deny: [...deny] })) };
}

/** Remove only a complete native source block whose provenance and content agree. */
export function filterNativeInstructions(system: Array<{ type: string; text?: string; metadata?: unknown }>, sources: string[], cache: Map<string, Map<string, string>>): void {
  // Prime the cache even when every team layer is selected: OpenCode can later
  // replay these exact original bytes after the files have changed on disk.
  if (!sources.length) {
    for (const part of system) {
      const entries = (part.metadata as { experimental?: { instructions?: Array<{ key: string; text: string }> } } | undefined)?.experimental?.instructions ?? [];
      const entry = entries.find((e) => e.key === "core/instructions");
      const first = entry?.text.match(/^Instructions from: ([^\n]+)\n/);
      if (first) try { filterNativeInstructions([{ ...part }], [first[1]], cache); } catch { /* No verified snapshot to reuse. */ }
    }
    return;
  }
  const removals = new Map<(typeof system)[number], string[]>();
  for (const source of sources) {
    const file = canonical(source);
    let removed = 0;
    for (const part of system) {
      if (part.type !== "text" || typeof part.text !== "string") continue;
      const metadata = part.metadata as { experimental?: { instructions?: Array<{ key: string; text: string }> } } | undefined;
      for (const entry of metadata?.experimental?.instructions ?? []) {
        if (entry.key !== "core/instructions" || !entry.text.includes(`Instructions from: ${file}\n`)) continue;
        if (!part.text.includes(entry.text)) throw new Error(`Ambiguous native instruction provenance: ${source}`);
        // Walk complete source bodies, not header-like text inside another file.
        let rest = entry.text;
        const matches: string[] = [];
        const verified = new Map<string, string>();
        while (rest) {
          const header = rest.match(/^Instructions from: ([^\n]+)\n/);
          if (!header) throw new Error(`Unrecognized native instruction provenance: ${source}`);
          let content = cache.get(entry.text)?.get(header[1]);
          if (content === undefined) try { content = fs.readFileSync(header[1], "utf8"); } catch { /* No verified bytes. */ }
          if (content === undefined) throw new Error(`Cannot verify native instruction provenance: ${header[1]}`);
          const block = header[0] + content;
          if (!rest.startsWith(block)) throw new Error(`Changed native instruction provenance: ${header[1]}`);
          verified.set(header[1], content);
          if (header[1] === file) matches.push(block);
          rest = rest.slice(block.length);
          if (rest.startsWith("\n\n")) rest = rest.slice(2);
          else if (rest) throw new Error(`Unrecognized native instruction boundary: ${source}`);
        }
        if (matches.length !== 1 || part.text.split(matches[0]).length !== 2) throw new Error(`Ambiguous native instruction provenance: ${source}`);
        cache.set(entry.text, verified);
        removals.set(part, [...(removals.get(part) ?? []), matches[0]]); removed++;
      }
    }
    if (removed !== 1) throw new Error(`Missing or ambiguous native instruction provenance: ${source}`);
  }
  for (const [part, blocks] of removals) for (const block of blocks) part.text = part.text!.replace(block, "");
}
