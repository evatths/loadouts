/**
 * YAML kind loader — reads *.yaml / *.yml files from .loadouts/kinds/ directories
 * and registers them as KindSpec entries in the registry.
 *
 * Declarative kind files let teams add new artifact types without writing code.
 * See plans/EXTENSIBILITY.md §3a for the full format.
 *
 * Loading is idempotent: kind files already loaded into the registry are skipped
 * silently on later calls. Other duplicate IDs are skipped with a warning.
 */

import * as path from "node:path";
import * as yaml from "yaml";
import { z } from "zod";
import { readFile, fileExists, isDirectory, listFiles } from "../lib/fs.js";
import { registry, type KindSpec, type OutputMapping, type PathTemplate } from "./registry.js";
import type { LoadoutRoot } from "./types.js";

const yamlKindSources = new Map<string, string>();

interface LoadYamlKindsOptions {
  /** Show advisory notes for valid-but-risky custom kind IDs. */
  showNamespaceNotes?: boolean;
}

// ---------------------------------------------------------------------------
// YAML schema
// ---------------------------------------------------------------------------

const YamlOutputMappingSchema = z.object({
  path: z.union([
    z.string(),
    z.object({ project: z.string(), global: z.string() }),
  ]),
  ext: z.string().optional(),
  // "generate" is code-only — YAML kinds cannot generate arbitrary content.
  mode: z.enum(["symlink", "copy"]).optional(),
  // Inline transforms require code; YAML kinds can only reference a named transform.
  transform: z.string().optional(),
});

const YamlKindDetectSchema = z.union([
  z.object({ pathPrefix: z.string() }),
  z.object({ pathExact: z.string() }),
]);

export const YamlKindSchema = z.object({
  /**
   * Unique kind identifier. Convention: namespace with a dot (e.g. "myteam.prompt")
   * to avoid collision with built-ins ("rule", "skill", "instruction") and other teams.
   */
  id: z.string().min(1),
  description: z.string().optional(),
  detect: YamlKindDetectSchema,
  layout: z.enum(["file", "dir"]),
  targets: z.record(z.string(), YamlOutputMappingSchema).optional(),
});

export type YamlKindDefinition = z.infer<typeof YamlKindSchema>;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a YAML kind definition file into a KindSpec.
 */
export function parseYamlKind(filePath: string): KindSpec {
  const content = readFile(filePath);
  const raw = yaml.parse(content);
  const def = YamlKindSchema.parse(raw);

  // Build detect predicate from the declarative spec
  const detect = buildDetect(def.detect);

  // Convert targets to OutputMappings
  const defaultTargets: Record<string, OutputMapping> = {};
  for (const [toolName, target] of Object.entries(def.targets ?? {})) {
    const mapping: OutputMapping = {
      path: target.path as PathTemplate,
    };
    if (target.ext !== undefined) mapping.ext = target.ext;
    if (target.mode !== undefined) mapping.mode = target.mode;
    if (target.transform !== undefined) mapping.transform = target.transform;
    defaultTargets[toolName] = mapping;
  }

  return {
    id: def.id,
    description: def.description,
    detect,
    layout: def.layout,
    defaultTargets,
  };
}

function buildDetect(
  spec: z.infer<typeof YamlKindDetectSchema>
): (relativePath: string) => boolean {
  if ("pathPrefix" in spec) {
    const prefix = spec.pathPrefix;
    return (rel) => rel.startsWith(prefix);
  }
  if ("pathExact" in spec) {
    const exact = spec.pathExact;
    return (rel) => rel === exact;
  }
  // TypeScript exhaustiveness guard
  throw new Error("Invalid detect spec");
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load all YAML kinds from the `kinds/` subdirectory of each discovered root
 * and register them into the global registry.
 *
 * Already-loaded YAML files are skipped silently. Other duplicate IDs are
 * skipped with a warning because the existing registration wins.
 * Parse errors are reported but do not abort loading.
 *
 * This is called synchronously from `resolveLoadout` after root discovery,
 * so YAML kinds are available for `inferKind()` during item resolution.
 */
export function loadYamlKindsFromRoots(
  roots: LoadoutRoot[],
  options: LoadYamlKindsOptions = {}
): void {
  for (const root of roots) {
    const kindsDir = path.join(root.path, "kinds");
    if (!isDirectory(kindsDir)) continue;

    const files = listFiles(kindsDir).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml")
    );

    for (const file of files) {
      const filePath = path.join(kindsDir, file);
      if (!fileExists(filePath)) continue;

      try {
        const kind = parseYamlKind(filePath);

        const existingKind = registry.getKind(kind.id);
        if (existingKind) {
          const source = yamlKindSources.get(kind.id);
          if (source === filePath) continue;

          const sourceDetail = source ? ` by ${source}` : "";
          console.warn(
            `[loadout] Warning: kind from ${filePath} was skipped — ` +
              `"${kind.id}" is already registered${sourceDetail}; existing definition takes precedence.`
          );
          continue;
        }

        // Unnamespaced IDs are valid, but may collide with future built-ins.
        if (options.showNamespaceNotes && !kind.id.includes(".")) {
          console.warn(
            `[loadout] Note: custom kind "${kind.id}" is unnamespaced. ` +
              `Consider "myteam.${kind.id}" to avoid future name collisions.`
          );
        }

        registry.registerKind(kind);
        yamlKindSources.set(kind.id, filePath);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already registered")) {
          console.warn(
            `[loadout] Warning: kind from ${filePath} was skipped — ` +
              `"${extractId(err.message)}" is already registered; existing definition takes precedence.`
          );
        } else {
          console.warn(
            `[loadout] Warning: could not load kind from ${filePath}: ` +
              (err instanceof Error ? err.message : String(err))
          );
        }
      }
    }
  }
}

function extractId(errMsg: string): string {
  const m = errMsg.match(/Kind "([^"]+)"/);
  return m ? m[1] : "unknown";
}
