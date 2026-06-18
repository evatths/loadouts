import { Command } from "commander";
import * as path from "node:path";
import * as yaml from "yaml";
import chalk from "chalk";
import { canonicalizeAgentContent, inferAgentHarness, type AgentHarness } from "../../core/agent-migration.js";
import { parseLoadoutDefinition } from "../../core/config.js";
import { resolveContexts, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import { fileExists, isDirectory, listFiles, readFile, removeFile, walkDir, writeFile } from "../../lib/fs.js";
import { rebuildAllGitignores } from "../../lib/gitignore.js";
import { heading, log } from "../../lib/output.js";
import type { CommandContext, LoadoutInclude } from "../../core/types.js";

export interface MigrateOptions extends ScopeFlags {
  from?: AgentHarness;
  dryRun?: boolean;
  keep?: boolean;
  force?: boolean;
  to?: string;
}

interface AgentMigrationCandidate {
  sourcePath: string;
  relativePath: string | null;
  harness: AgentHarness;
  name: string;
  destRelativePath: string;
  destPath: string;
  content: string;
}

export interface MigrationResult {
  migrated: AgentMigrationCandidate[];
  skipped: Array<{ sourcePath: string; reason: string }>;
}

function isAgentFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".toml";
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function toPosix(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function relativeToLoadout(loadoutPath: string, sourcePath: string): string | null {
  const rel = path.relative(loadoutPath, sourcePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return toPosix(rel);
}

function shouldConsiderPath(relativePath: string | null, sourcePath: string): boolean {
  const normalized = (relativePath ?? sourcePath.replace(/\\/g, "/")).replace(/^\/+/, "");
  return /(^|\/)agents\/[^/]+\.(md|toml)$/i.test(normalized);
}

function collectAgentFiles(sourcePath: string): string[] {
  if (!fileExists(sourcePath)) return [];
  if (!isDirectory(sourcePath)) return isAgentFile(sourcePath) ? [sourcePath] : [];
  return walkDir(sourcePath)
    .map((rel) => path.join(sourcePath, rel))
    .filter(isAgentFile);
}

function buildCandidate(
  ctx: CommandContext,
  sourcePath: string,
  options: MigrateOptions
): AgentMigrationCandidate | null {
  const relativePath = relativeToLoadout(ctx.configPath, sourcePath);
  if (!shouldConsiderPath(relativePath, sourcePath)) return null;

  const raw = readFile(sourcePath);
  const harness = options.from ?? inferAgentHarness(sourcePath, raw);
  const canonical = canonicalizeAgentContent(raw, { harness, sourcePath });
  const destRelativePath = `agents/${canonical.name}.md`;
  const destPath = path.join(ctx.configPath, destRelativePath);

  return {
    sourcePath,
    relativePath,
    harness: canonical.harness,
    name: canonical.name,
    destRelativePath,
    destPath,
    content: canonical.content,
  };
}

function candidateSources(ctx: CommandContext, source: string | undefined): string[] {
  if (source) {
    const sourcePath = path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
    return collectAgentFiles(sourcePath);
  }

  const roots = [
    path.join(ctx.configPath, "opencode", "agents"),
    path.join(ctx.configPath, "cursor", "agents"),
    path.join(ctx.configPath, "claude-code", "agents"),
    path.join(ctx.configPath, "claude", "agents"),
    path.join(ctx.configPath, "codex", "agents"),
    path.join(ctx.configPath, "agents"),
  ];

  return roots.flatMap(collectAgentFiles);
}

function sourceToolForInclude(harness: AgentHarness): string | undefined {
  return harness === "canonical" ? undefined : harness;
}

function includePath(include: LoadoutInclude): string {
  return typeof include === "string" ? include : include.path;
}

function includeWithPathAndTools(
  original: LoadoutInclude,
  pathValue: string,
  harness: AgentHarness
): LoadoutInclude {
  const existingTools = typeof original === "string" ? undefined : original.tools;
  const sourceTool = sourceToolForInclude(harness);
  if (existingTools) return { path: pathValue, tools: existingTools };
  if (sourceTool) return { path: pathValue, tools: [sourceTool] };
  return pathValue;
}

function updateLoadoutIncludes(
  ctx: CommandContext,
  candidates: AgentMigrationCandidate[],
  options: MigrateOptions
): string[] {
  const loadoutsDir = path.join(ctx.configPath, "loadouts");
  if (!isDirectory(loadoutsDir)) return [];

  const changed: string[] = [];
  const candidateByRelative = new Map(
    candidates
      .filter((candidate) => candidate.relativePath)
      .map((candidate) => [candidate.relativePath!, candidate])
  );
  if (candidateByRelative.size === 0) return [];

  const loadoutFiles = listFiles(loadoutsDir)
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .filter((entry) => !options.to || entry.replace(/\.ya?ml$/, "") === options.to);

  for (const file of loadoutFiles) {
    const filePath = path.join(loadoutsDir, file);
    const def = parseLoadoutDefinition(filePath);
    let modified = false;
    const seen = new Set<string>();
    const nextIncludes: LoadoutInclude[] = [];

    for (const entry of def.include) {
      const currentPath = includePath(entry);
      const candidate = candidateByRelative.get(currentPath);
      if (!candidate) {
        const key = `${currentPath}:${JSON.stringify(typeof entry === "string" ? undefined : entry.tools)}`;
        if (!seen.has(key)) {
          seen.add(key);
          nextIncludes.push(entry);
        }
        continue;
      }

      const replacement = includeWithPathAndTools(entry, candidate.destRelativePath, candidate.harness);
      const replacementKey = `${candidate.destRelativePath}:${JSON.stringify(typeof replacement === "string" ? undefined : replacement.tools)}`;
      if (!seen.has(replacementKey)) {
        seen.add(replacementKey);
        nextIncludes.push(replacement);
      }
      modified = true;
    }

    if (modified) {
      def.include = nextIncludes;
      if (!options.dryRun) writeFile(filePath, yaml.stringify(def));
      changed.push(file);
    }
  }

  return changed;
}

export async function runMigrateAgents(
  ctx: CommandContext,
  source: string | undefined,
  options: MigrateOptions
): Promise<MigrationResult> {
  const skipped: MigrationResult["skipped"] = [];
  const candidates = candidateSources(ctx, source)
    .map((filePath) => buildCandidate(ctx, filePath, options))
    .filter((candidate): candidate is AgentMigrationCandidate => !!candidate);

  const unique = new Map<string, AgentMigrationCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.sourcePath)) unique.set(candidate.sourcePath, candidate);
  }

  const migrated: AgentMigrationCandidate[] = [];
  for (const candidate of unique.values()) {
    const samePath = path.resolve(candidate.sourcePath) === path.resolve(candidate.destPath);
    if (fileExists(candidate.destPath) && !samePath && !options.force) {
      skipped.push({ sourcePath: candidate.sourcePath, reason: `${candidate.destRelativePath} already exists` });
      continue;
    }

    if (!options.dryRun) {
      writeFile(candidate.destPath, candidate.content);
      if (!options.keep && !samePath && isPathWithin(ctx.configPath, candidate.sourcePath)) {
        removeFile(candidate.sourcePath);
      }
    }
    migrated.push(candidate);
  }

  const changedLoadouts = updateLoadoutIncludes(ctx, migrated, options);
  if (!options.dryRun && migrated.length > 0) {
    rebuildAllGitignores(ctx.configPath, ctx.projectRoot, ctx.scope);
  }

  if (migrated.length > 0 || skipped.length > 0) {
    heading(options.dryRun ? "Agent Migration Preview" : "Agent Migration");
    for (const candidate of migrated) {
      const sourceLabel = candidate.relativePath ?? candidate.sourcePath;
      log.success(`${sourceLabel} -> ${candidate.destRelativePath}`);
      log.dim(`  source harness: ${candidate.harness}`);
    }
    for (const item of skipped) {
      log.warn(`Skipped ${item.sourcePath}: ${item.reason}`);
    }
    if (changedLoadouts.length > 0) {
      log.dim(`  Updated loadouts: ${changedLoadouts.join(", ")}`);
    }
  }

  return { migrated, skipped };
}

export const migrateCommand = new Command("migrate")
  .description("Migrate legacy artifacts to canonical formats");

migrateCommand
  .command("agents")
  .description("Migrate native harness agent definitions to canonical agents")
  .argument("[source]", "Optional agent file or directory to migrate")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--from <harness>", "Source harness override (opencode, cursor, claude-code, codex)")
  .option("--to <loadout>", "Only update includes in this loadout")
  .option("--dry-run", "Preview migration without writing files")
  .option("--keep", "Keep old files after writing canonical agents")
  .option("--force", "Overwrite existing canonical agents")
  .action(async (source: string | undefined, options: MigrateOptions) => {
    let contexts: CommandContext[] = [];
    try {
      ({ contexts } = await resolveContexts(options, process.cwd()));
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let totalMigrated = 0;
    let totalSkipped = 0;
    for (const ctx of contexts) {
      const result = await runMigrateAgents(ctx, source, options);
      totalMigrated += result.migrated.length;
      totalSkipped += result.skipped.length;
    }

    if (totalMigrated === 0 && totalSkipped === 0) {
      log.dim("No agent files found to migrate.");
      return;
    }

    console.log();
    const summary = `${totalMigrated} migrated, ${totalSkipped} skipped`;
    if (totalSkipped > 0) log.warn(summary);
    else log.success(chalk.green(summary));
  });
