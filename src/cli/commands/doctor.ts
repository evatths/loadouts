/**
 * loadouts doctor — Check and repair loadout health.
 *
 * Focuses on migration drift so environments stay up to date after upgrades:
 *   - Per-target .gitignore entries for managed artifacts
 *   - .loadouts/.gitignore state paths
 *   - Legacy root .gitignore managed sections
 */

import { Command } from "commander";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { findNearestLoadoutRoot, getGlobalRoot } from "../../core/discovery.js";
import { loadYamlKindsFromRoots } from "../../core/kindLoader.js";
import { registry } from "../../core/registry.js";
import { resolveScopes, SCOPE_FLAGS, type ScopeFlags } from "../../core/scope.js";
import type { LoadoutRoot, Scope, Tool } from "../../core/types.js";
import {
  getManagedPathsFromTarget,
  inspectGitignoreHealth,
  rebuildAllGitignores,
  removeLegacyRootGitignoreSection,
  updateTargetGitignore,
  updateLoadoutsGitignore,
  type GitignoreHealthReport,
} from "../../lib/gitignore.js";
import {
  calculateColumnWidths,
  getToolColumns,
  renderHeader,
  renderSeparator,
  sortArtifacts,
  truncatePath,
} from "../../lib/artifact-table.js";
import { heading, log, list } from "../../lib/output.js";

interface DoctorOptions extends ScopeFlags {
  check?: boolean;
  fix?: boolean;
  yes?: boolean;
  verbose?: boolean;
}

interface ScopeHealth {
  scope: Scope;
  rootPath: string;
  projectRoot: string;
  report: GitignoreHealthReport;
}

interface FixAction {
  label: string;
  apply: () => void;
}

interface ArtifactDriftRow {
  kind: string;
  name: string;
  toolStatus: Map<Tool, "missing" | "stale" | "ok">;
  missingPaths: Map<Tool, string[]>;
  stalePaths: Map<Tool, string[]>;
}

interface ScopeDrift {
  scope: Scope;
  tools: Tool[];
  artifacts: ArtifactDriftRow[];
  unresolvedPaths: string[];
}

interface DriftAnalysis {
  scopeDrifts: ScopeDrift[];
}

interface IssueDetailRow {
  scope: string;
  issue: string;
  path: string;
  reason: string;
}

function formatScope(scope: Scope): string {
  return scope === "project" ? "project" : "global";
}

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

function renderHealthTable(healthByScope: ScopeHealth[]): void {
  const rows = healthByScope.map(({ scope, report }) => {
    const status = report.issues === 0 ? "healthy" : "issues";
    const targetCell = report.targetMismatches.length === 0 ? "✓" : `~${report.targetMismatches.length}`;
    return {
      scope: formatScope(scope),
      legacy: report.hasLegacyRootSection ? "!" : "✓",
      state: report.loadoutsStateOutOfDate ? "!" : "✓",
      targets: targetCell,
      status,
    };
  });

  if (rows.length === 0) {
    log.dim("  No scopes available.");
    return;
  }

  const scopeWidth = Math.max("scope".length, ...rows.map((r) => r.scope.length));
  const statusWidth = Math.max("status".length, ...rows.map((r) => r.status.length));

  const header = [
    chalk.dim("scope".padEnd(scopeWidth)),
    chalk.dim("legacy"),
    chalk.dim("state"),
    chalk.dim("targets"),
    chalk.dim("status".padEnd(statusWidth)),
  ].join("  ");
  console.log(`  ${header}`);

  const separator = [
    "─".repeat(scopeWidth),
    "─".repeat("legacy".length),
    "─".repeat("state".length),
    "─".repeat("targets".length),
    "─".repeat(statusWidth),
  ].join("  ");
  console.log(chalk.dim(`  ${separator}`));

  for (const row of rows) {
    const legacy = row.legacy === "!" ? chalk.red("!") : chalk.green("✓");
    const state = row.state === "!" ? chalk.red("!") : chalk.green("✓");
    const targets = row.targets.startsWith("~")
      ? chalk.yellow(row.targets)
      : chalk.green(row.targets);
    const status =
      row.status === "healthy"
        ? chalk.green(row.status.padEnd(statusWidth))
        : chalk.yellow(row.status.padEnd(statusWidth));

    console.log(
      `  ${row.scope.padEnd(scopeWidth)}  ${legacy.padEnd("legacy".length)}  ${state.padEnd("state".length)}  ${targets.padEnd("targets".length)}  ${status}`
    );
  }
}

function analyzeDrift(healthByScope: ScopeHealth[]): DriftAnalysis {
  const driftByScope = new Map<Scope, { tools: Set<Tool>; artifacts: Map<string, ArtifactDriftRow>; unresolvedPaths: Set<string> }>();

  for (const { scope, rootPath, projectRoot, report } of healthByScope) {
    if (report.issues === 0) continue;

    if (report.targetMismatches.length > 0) {
      const scopeDrift =
        driftByScope.get(scope) ??
        ({ tools: new Set<Tool>(), artifacts: new Map<string, ArtifactDriftRow>(), unresolvedPaths: new Set<string>() } as const);

      for (const mismatch of report.targetMismatches) {
        const expected = new Set(mismatch.expectedPaths);
        const actual = new Set(mismatch.actualPaths);
        const tool = inferToolForTarget(scope, projectRoot, mismatch.targetDir);
        if (tool) {
          scopeDrift.tools.add(tool);
        }

        for (const expectedPath of mismatch.expectedPaths) {
          const artifact = inferArtifactFromGitignorePath(expectedPath);
          if (!artifact || !tool) continue;

          const key = `${artifact.kind}:${artifact.name}`;
          const row =
            scopeDrift.artifacts.get(key) ??
            ({
              kind: artifact.kind,
              name: artifact.name,
              toolStatus: new Map<Tool, "missing" | "stale" | "ok">(),
              missingPaths: new Map<Tool, string[]>(),
              stalePaths: new Map<Tool, string[]>(),
            } satisfies ArtifactDriftRow);

          const status: "ok" | "missing" = actual.has(expectedPath) ? "ok" : "missing";
          const existing = row.toolStatus.get(tool);
          if (!existing || status === "missing") {
            row.toolStatus.set(tool, status);
          }
          if (status === "missing") {
            row.missingPaths.set(tool, [...(row.missingPaths.get(tool) ?? []), expectedPath]);
          }

          scopeDrift.artifacts.set(key, row);
        }

        for (const actualPath of mismatch.actualPaths) {
          if (expected.has(actualPath)) continue;
          const artifact = inferArtifactFromGitignorePath(actualPath);
          if (!artifact || !tool) {
            const targetGitignore = formatPath(path.join(mismatch.targetDir, ".gitignore"), projectRoot);
            scopeDrift.unresolvedPaths.add(`${targetGitignore}: ${actualPath}`);
            continue;
          }

          const key = `${artifact.kind}:${artifact.name}`;
          const row =
            scopeDrift.artifacts.get(key) ??
            ({
              kind: artifact.kind,
              name: artifact.name,
              toolStatus: new Map<Tool, "missing" | "stale" | "ok">(),
              missingPaths: new Map<Tool, string[]>(),
              stalePaths: new Map<Tool, string[]>(),
            } satisfies ArtifactDriftRow);

          const existing = row.toolStatus.get(tool);
          if (existing !== "missing") {
            row.toolStatus.set(tool, "stale");
          }
          row.stalePaths.set(tool, [...(row.stalePaths.get(tool) ?? []), actualPath]);
          scopeDrift.artifacts.set(key, row);
        }
      }

      driftByScope.set(scope, scopeDrift);
    }

  }

  const scopeDrifts: ScopeDrift[] = [...driftByScope.entries()].map(([scope, drift]) => ({
    scope,
    tools: [...drift.tools],
    artifacts: [...drift.artifacts.values()],
    unresolvedPaths: [...drift.unresolvedPaths].sort(),
  }));

  return { scopeDrifts };
}

function renderHealthDetails(healthByScope: ScopeHealth[], analysis: DriftAnalysis, verbose: boolean): void {
  const issueDetails: IssueDetailRow[] = [];

  for (const { scope, rootPath, projectRoot, report } of healthByScope) {
    if (report.issues === 0) continue;

    const scopeLabel = `[${formatScope(scope)}]`;
    if (report.hasLegacyRootSection) {
      const rootGitignore = path.join(projectRoot, ".gitignore");
      log.warn(`${scopeLabel} legacy managed section in ${rootGitignore}`);
      issueDetails.push({
        scope: formatScope(scope),
        issue: "legacy",
        path: formatPath(rootGitignore, projectRoot),
        reason: "legacy managed marker section present",
      });
    }
    if (report.loadoutsStateOutOfDate) {
      log.warn(`${scopeLabel} ${path.join(rootPath, ".gitignore")} missing required state entries`);
      issueDetails.push({
        scope: formatScope(scope),
        issue: "state",
        path: formatPath(path.join(rootPath, ".gitignore"), projectRoot),
        reason: "required state entries missing or stale",
      });
    }
    if (report.targetMismatches.length > 0) {
      log.warn(`${scopeLabel} ${report.targetMismatches.length} target .gitignore file(s) out of date`);

      for (const mismatch of report.targetMismatches) {
        const expected = new Set(mismatch.expectedPaths);
        const actual = new Set(mismatch.actualPaths);
        const missing = mismatch.expectedPaths.filter((p) => !actual.has(p)).length;
        const stale = mismatch.actualPaths.filter((p) => !expected.has(p)).length;
        const unknownExpected = mismatch.expectedPaths.filter(
          (p) => !inferArtifactFromGitignorePath(p)
        ).length;
        const unknownActual = mismatch.actualPaths.filter(
          (p) => !inferArtifactFromGitignorePath(p)
        ).length;

        const reasons: string[] = [];
        if (missing > 0) reasons.push(`${missing} missing`);
        if (stale > 0) reasons.push(`${stale} stale`);
        if (unknownExpected > 0) reasons.push(`${unknownExpected} unknown expected`);
        if (unknownActual > 0) reasons.push(`${unknownActual} unknown stale`);
        if (reasons.length === 0) reasons.push("managed section differs");

        issueDetails.push({
          scope: formatScope(scope),
          issue: "target",
          path: formatPath(path.join(mismatch.targetDir, ".gitignore"), projectRoot),
          reason: reasons.join(", "),
        });
      }
    }
  }

  if (issueDetails.length > 0) {
    console.log();
    renderIssueDetailsTable(issueDetails);
  }

  for (const scopeDrift of analysis.scopeDrifts) {
    if (scopeDrift.artifacts.length === 0) continue;
    console.log();
    renderArtifactDriftTable(scopeDrift);

    if (verbose && scopeDrift.unresolvedPaths.length > 0) {
      console.log();
      log.info(`[${formatScope(scopeDrift.scope)}] unmanaged stale entries`);
      list(scopeDrift.unresolvedPaths);
    }
  }
}

function renderIssueDetailsTable(rows: IssueDetailRow[]): void {
  log.info("Issue details");

  const scopeWidth = Math.max("scope".length, ...rows.map((r) => r.scope.length));
  const issueWidth = Math.max("issue".length, ...rows.map((r) => r.issue.length));
  const pathWidth = Math.max("path".length, ...rows.map((r) => r.path.length));

  const header = [
    chalk.dim("scope".padEnd(scopeWidth)),
    chalk.dim("issue".padEnd(issueWidth)),
    chalk.dim("path".padEnd(pathWidth)),
    chalk.dim("reason"),
  ].join("  ");
  console.log(`  ${header}`);

  const separator = [
    "─".repeat(scopeWidth),
    "─".repeat(issueWidth),
    "─".repeat(pathWidth),
    "─".repeat("reason".length),
  ].join("  ");
  console.log(chalk.dim(`  ${separator}`));

  for (const row of rows) {
    console.log(
      `  ${row.scope.padEnd(scopeWidth)}  ${row.issue.padEnd(issueWidth)}  ${row.path.padEnd(pathWidth)}  ${row.reason}`
    );
  }
}

function inferToolForTarget(scope: Scope, projectRoot: string, targetDir: string): Tool | null {
  const normalizedTarget = path.resolve(targetDir);
  for (const tool of registry.allTools()) {
    const base = tool.basePath[scope];
    const resolvedBase = path.resolve(path.isAbsolute(base) ? base : path.join(projectRoot, base));
    if (resolvedBase === normalizedTarget) {
      return tool.name;
    }
  }

  return null;
}

function inferArtifactFromGitignorePath(relativePath: string): { kind: string; name: string } | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/\/$/, "");

  const skillMatch = normalized.match(/^skills\/([^/]+)/);
  if (skillMatch) return { kind: "skill", name: skillMatch[1] };

  const ruleMatch = normalized.match(/^rules\/(.+)\.md$/);
  if (ruleMatch) return { kind: "rule", name: ruleMatch[1] };

  const promptMatch = normalized.match(/^prompts\/(.+)\.md$/);
  if (promptMatch) return { kind: "prompt", name: promptMatch[1] };

  const instructionMatch = normalized.match(/^instructions\/(.+\.md)$/);
  if (instructionMatch) return { kind: "instruction", name: instructionMatch[1] };

  const extensionMatch = normalized.match(/^extensions\/(.+)$/);
  if (extensionMatch) return { kind: "extension", name: extensionMatch[1] };

  const themeMatch = normalized.match(/^themes\/(.+)$/);
  if (themeMatch) return { kind: "theme", name: themeMatch[1] };

  const pluginMatch = normalized.match(/^opencode\/plugins\/(.+)$/);
  if (pluginMatch) return { kind: "opencode-plugin", name: pluginMatch[1] };

  const opencodeConfigMatch = normalized.match(/^opencode\/(.+)$/);
  if (opencodeConfigMatch) return { kind: "opencode-config", name: opencodeConfigMatch[1] };

  if (/\.md$/i.test(normalized) && !normalized.includes("/")) {
    return { kind: "instruction", name: normalized };
  }

  return null;
}

function formatPath(absPath: string, projectRoot: string): string {
  const home = os.homedir();
  if (absPath === projectRoot) return ".";
  if (absPath.startsWith(projectRoot + path.sep)) {
    return path.relative(projectRoot, absPath);
  }
  if (absPath === home) return "~";
  if (absPath.startsWith(home + path.sep)) {
    return `~/${path.relative(home, absPath)}`;
  }
  return absPath;
}

function renderArtifactDriftTable(scopeDrift: ScopeDrift): void {
  const rowsWithDrift = scopeDrift.artifacts.filter((row) =>
    [...row.toolStatus.values()].some((status) => status !== "ok")
  );

  if (rowsWithDrift.length === 0) {
    return;
  }

  const sortedRows = sortArtifacts(rowsWithDrift);
  const allTools = registry.allTools().map((tool) => tool.name);
  const tools = allTools.filter((tool) => scopeDrift.tools.includes(tool));

  log.info(`[${formatScope(scopeDrift.scope)}] artifact drift by target`);
  const { kindWidth, nameWidth } = calculateColumnWidths(sortedRows);
  const toolCols = getToolColumns(tools);
  renderHeader(kindWidth, nameWidth, toolCols);
  renderSeparator(kindWidth, nameWidth, toolCols);

  for (const row of sortedRows) {
    const kindCell = chalk.dim(row.kind.padEnd(kindWidth));
    const nameCell = truncatePath(row.name, nameWidth).padEnd(nameWidth);
    const toolCells = toolCols
      .map((column) => {
        const status = row.toolStatus.get(column.tool);
        if (!status) {
          return chalk.dim("—") + " ".repeat(column.width - 1);
        }

        const symbol =
          status === "missing" ? chalk.red("!") : status === "stale" ? chalk.yellow("~") : chalk.green("✓");
        return symbol + " ".repeat(column.width - 1);
      })
      .join("  ");

    console.log(`  ${kindCell}  ${nameCell}  ${toolCells}`);
  }

  console.log();
  log.dim("  ! missing expected entry");
  log.dim("  ~ stale extra entry");
  log.dim("  ✓ in sync");
}

function getToolTargetDir(scope: Scope, projectRoot: string, tool: Tool): string {
  const toolDef = registry.getTool(tool);
  if (!toolDef) {
    throw new Error(`Unknown tool: ${tool}`);
  }
  const base = toolDef.basePath[scope];
  return path.isAbsolute(base) ? base : path.join(projectRoot, base);
}

function applyArtifactFix(scope: Scope, projectRoot: string, artifact: ArtifactDriftRow): void {
  const tools = new Set<Tool>([
    ...artifact.missingPaths.keys(),
    ...artifact.stalePaths.keys(),
  ]);

  for (const tool of tools) {
    const targetDir = getToolTargetDir(scope, projectRoot, tool);
    const managed = new Set(getManagedPathsFromTarget(targetDir));

    for (const stalePath of artifact.stalePaths.get(tool) ?? []) {
      managed.delete(stalePath);
    }
    for (const missingPath of artifact.missingPaths.get(tool) ?? []) {
      managed.add(missingPath);
    }

    updateTargetGitignore(targetDir, [...managed].sort());
  }
}

function collectFixActions(healthByScope: ScopeHealth[], analysis: DriftAnalysis): FixAction[] {
  const actions: FixAction[] = [];

  for (const { scope, rootPath, projectRoot, report } of healthByScope) {
    const scopeLabel = formatScope(scope);
    let artifactFixCount = 0;

    if (report.hasLegacyRootSection) {
      const gitignorePath = path.join(projectRoot, ".gitignore");
      actions.push({
        label: `[${scopeLabel}] remove legacy managed section from ${gitignorePath}`,
        apply: () => removeLegacyRootGitignoreSection(projectRoot),
      });
    }

    if (report.loadoutsStateOutOfDate) {
      const gitignorePath = path.join(rootPath, ".gitignore");
      actions.push({
        label: `[${scopeLabel}] update ${gitignorePath} state entries`,
        apply: () => updateLoadoutsGitignore(rootPath),
      });
    }

    const scopeDrift = analysis.scopeDrifts.find((item) => item.scope === scope);
    if (scopeDrift) {
      for (const artifact of sortArtifacts(scopeDrift.artifacts)) {
        const hasDrift = [...artifact.toolStatus.values()].some((status) => status !== "ok");
        if (!hasDrift) continue;

        const driftTools = [...artifact.toolStatus.entries()]
          .filter(([, status]) => status !== "ok")
          .map(([tool]) => tool);
        actions.push({
          label: `[${scopeLabel}] fix ${artifact.kind}/${artifact.name} on ${driftTools.join(", ")}`,
          apply: () => applyArtifactFix(scope, projectRoot, artifact),
        });
        artifactFixCount += 1;
      }

      if (scopeDrift.unresolvedPaths.length > 0) {
        actions.push({
          label: `[${scopeLabel}] rebuild ${report.targetMismatches.length} target .gitignore file(s) (fallback for unresolved paths)`,
          apply: () => rebuildAllGitignores(rootPath, projectRoot, scope),
        });
      }
    }

    if (report.targetMismatches.length > 0 && artifactFixCount === 0) {
      actions.push({
        label: `[${scopeLabel}] rebuild ${report.targetMismatches.length} target .gitignore file(s)`,
        apply: () => rebuildAllGitignores(rootPath, projectRoot, scope),
      });
    }
  }

  return actions;
}

async function promptFixActions(actions: FixAction[]): Promise<FixAction[]> {
  if (actions.length === 0) return [];

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log.warn("Interactive selection requires a TTY; run with --yes to apply all fixes.");
    return [];
  }

  console.log();
  log.info("Select fixes to apply (artifact-by-artifact):");
  actions.forEach((action, idx) => {
    console.log(`  ${chalk.dim(String(idx + 1) + ".")} ${action.label}`);
  });
  log.dim("  Enter numbers (for example: 1,3), 'a' for all, 'q' to cancel, or press Enter for all.");

  const rl = createPrompt();
  try {
    const answer = await askQuestion(rl, "Apply fixes: ");

    if (answer === "q" || answer === "quit" || answer === "cancel") return [];
    if (!answer) return actions;
    if (answer === "a" || answer === "all") return actions;

    const selected = new Set<number>();
    for (const token of answer.split(",").map((s) => s.trim())) {
      const idx = Number.parseInt(token, 10);
      if (!Number.isNaN(idx) && idx >= 1 && idx <= actions.length) {
        selected.add(idx - 1);
      }
    }

    return [...selected].sort((a, b) => a - b).map((idx) => actions[idx]);
  } finally {
    rl.close();
  }
}

async function resolveRootInfo(
  scope: Scope,
  cwd: string
): Promise<{ rootPath: string; projectRoot: string } | null> {
  if (scope === "project") {
    const root = await findNearestLoadoutRoot(cwd);
    if (!root) return null;
    return { rootPath: root.path, projectRoot: path.dirname(root.path) };
  }

  const root = getGlobalRoot();
  if (!root) return null;
  return { rootPath: root.path, projectRoot: os.homedir() };
}

export const doctorCommand = new Command("doctor")
  .description("Diagnose loadout health and optionally fix drift")
  .option(...SCOPE_FLAGS.local)
  .option(...SCOPE_FLAGS.global)
  .option(...SCOPE_FLAGS.all)
  .option("--check", "Check only (default)")
  .option("--fix", "Apply selected fixes interactively")
  .option("-y, --yes", "Apply all available fixes without prompting")
  .option("-v, --verbose", "Show detailed diagnostics")
  .action(async (options: DoctorOptions) => {
    if (options.check && options.fix) {
      log.error("--check and --fix cannot be used together");
      process.exit(1);
    }

    const cwd = process.cwd();
    const scopes = await resolveScopes(options, cwd);

    heading("Loadout doctor");
    console.log();

    const healthByScope: ScopeHealth[] = [];

    for (const scope of scopes) {
      const info = await resolveRootInfo(scope, cwd);
      if (!info) continue;

      const report = inspectGitignoreHealth(info.rootPath, info.projectRoot, scope);
      healthByScope.push({
        scope,
        rootPath: info.rootPath,
        projectRoot: info.projectRoot,
        report,
      });
    }

    if (healthByScope.length === 0) {
      log.warn("No loadout roots found for selected scope(s)");
      return;
    }

    const roots: LoadoutRoot[] = healthByScope.map((item) => ({
      path: item.rootPath,
      level: item.scope === "global" ? "global" : "project",
      depth: 0,
    }));
    loadYamlKindsFromRoots(roots, { showNamespaceNotes: true });

    renderHealthTable(healthByScope);

    const initialIssues = healthByScope.reduce((sum, item) => sum + item.report.issues, 0);

    console.log();
    if (initialIssues === 0) {
      log.success("All checked scopes are healthy");
      return;
    }

    const analysis = analyzeDrift(healthByScope);
    renderHealthDetails(healthByScope, analysis, !!options.verbose);
    console.log();

    if (!options.fix) {
      log.warn(`Found ${initialIssues} issue(s)`);
      log.dim("Run 'loadouts doctor --fix' to choose fixes interactively.");
      process.exit(1);
    }

    const actions = collectFixActions(healthByScope, analysis);
    const selectedFromPrompt = options.yes ? actions : await promptFixActions(actions);
    const selectedActions =
      !options.yes && selectedFromPrompt.length === 0 && actions.length > 0
        ? actions
        : selectedFromPrompt;

    if (selectedActions.length === 0) {
      log.warn("No fixes selected");
      process.exit(1);
    }

    console.log();
    for (const action of selectedActions) {
      log.info(`Applying: ${action.label}`);
      action.apply();
    }

    const afterHealthByScope: ScopeHealth[] = healthByScope.map((item) => ({
      ...item,
      report: inspectGitignoreHealth(item.rootPath, item.projectRoot, item.scope),
    }));

    const remainingIssues = afterHealthByScope.reduce((sum, item) => sum + item.report.issues, 0);

    console.log();
    heading("Post-fix health");
    console.log();
    renderHealthTable(afterHealthByScope);
    console.log();

    if (remainingIssues === 0) {
      log.success(`Repaired ${initialIssues} issue(s)`);
      return;
    }

    log.warn(`Repaired ${initialIssues - remainingIssues} issue(s); ${remainingIssues} remain`);
    log.dim("Run 'loadouts doctor --fix' again to resolve remaining issues.");
    process.exit(1);
  });
