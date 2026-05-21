import { Command } from "commander";
import { getContext } from "../../core/discovery.js";
import { loadResolvedLoadouts } from "../../core/resolve.js";
import { compileRuntimeBundle, renderRuntimeSystemBlock } from "../../core/runtime.js";
import { registry } from "../../core/registry.js";
import { requireScopeForName, resolveScopes } from "../../core/scope.js";
import { heading, keyValue, list, log } from "../../lib/output.js";
import type { RuntimeBundle } from "../../core/runtime.js";
import type { Scope, Tool } from "../../core/types.js";

interface RuntimeOptions {
  tool?: string;
  json?: boolean;
  systemBlock?: boolean;
  local?: boolean;
  global?: boolean;
}

export interface RuntimeCompileResult {
  bundle: RuntimeBundle;
  loadoutNames: string[];
  sourceWarnings: string[];
  scope: Scope;
}

function normalizeToolName(tool: string): Tool {
  const normalized = tool.trim() as Tool;
  const toolDef = registry.getTool(normalized);
  if (!toolDef) {
    throw new Error(`Unknown tool: ${tool}`);
  }
  return normalized;
}

async function resolveRuntimeScope(names: string[], options: RuntimeOptions, cwd: string): Promise<Scope> {
  if (options.local && options.global) {
    throw new Error("Use either --local or --global, not both.");
  }

  if (options.local) return "project";
  if (options.global) return "global";

  if (names.length > 0) {
    const targetScope = await requireScopeForName(names[0], {}, cwd);
    for (const name of names.slice(1)) {
      const scope = await requireScopeForName(name, {}, cwd);
      if (scope !== targetScope) {
        throw new Error(
          "Loadout names resolve to different scopes. Use --local or --global to choose one scope."
        );
      }
    }
    return targetScope;
  }

  const scopes = await resolveScopes({}, cwd);
  return scopes.includes("project") ? "project" : scopes[0];
}

export async function runRuntime(
  names: string[],
  options: RuntimeOptions,
  cwd: string = process.cwd()
): Promise<RuntimeCompileResult> {
  if (options.json && options.systemBlock) {
    throw new Error("Use either --json or --system-block, not both.");
  }

  const tool = normalizeToolName(options.tool || "opencode");
  const scope = await resolveRuntimeScope(names, options, cwd);
  const ctx = await getContext(scope, cwd);
  const { loadouts, loadoutNames, sourceWarnings } = await loadResolvedLoadouts(ctx, names, {
    includeBundled: true,
  });

  const bundle = compileRuntimeBundle(tool, loadouts);
  return { bundle, loadoutNames, sourceWarnings, scope };
}

export function runtimeSystemBlock(bundle: RuntimeBundle): string {
  return renderRuntimeSystemBlock(bundle);
}

function renderRuntimeHuman(result: RuntimeCompileResult): void {
  const { bundle, loadoutNames, scope, sourceWarnings } = result;
  heading(`Runtime bundle (${scope})`);
  keyValue({
    Loadouts: loadoutNames.join(", "),
    Tool: bundle.tool,
    Fingerprint: bundle.fingerprint,
    Injected: `instructions=${bundle.injection.instructions.length}, rules=${bundle.injection.rules.length}, skills=${bundle.injection.skills.length}`,
  });

  log.dim(
    `  Capabilities: mode=${bundle.capabilities.runtimeMode}, modelInjection(instructions=${bundle.capabilities.modelInjection.instructions}, rules=${bundle.capabilities.modelInjection.rules}), skillPathDiscovery=${bundle.capabilities.skillPathDiscovery}, nativeSkillHotSwap=${bundle.capabilities.nativeSkillHotSwap}`
  );

  if (sourceWarnings.length > 0) {
    console.log();
    log.warn("Source warnings:");
    list(sourceWarnings);
  }

  if (bundle.diagnostics.length > 0) {
    console.log();
    log.warn(`Diagnostics (${bundle.diagnostics.length}):`);
    list(bundle.diagnostics.map((d) => `[${d.code}] ${d.message} (${d.relativePath})`));
  }
}

export const runtimeCommand = new Command("runtime")
  .description("Compile runtime bundle JSON for a tool")
  .argument("[names...]", "Loadout names (defaults to root default/base)")
  .option("--tool <tool>", "Target tool", "opencode")
  .option("--json", "Output RuntimeBundle JSON only")
  .option("--system-block", "Output renderRuntimeSystemBlock(bundle) only")
  .option("-l, --local", "Project scope only")
  .option("-g, --global", "Global scope only")
  .action(async (names: string[], options: RuntimeOptions) => {
    try {
      const result = await runRuntime(names, options);
      if (options.json) {
        console.log(JSON.stringify(result.bundle, null, 2));
        return;
      }
      if (options.systemBlock) {
        process.stdout.write(runtimeSystemBlock(result.bundle));
        return;
      }
      renderRuntimeHuman(result);
    } catch (err) {
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
