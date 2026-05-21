/**
 * OpenCode runtime integration scaffold (reference implementation).
 *
 * This is intentionally conservative and uses the current CLI JSON bridge:
 *   loadouts runtime <names...> --tool opencode --json
 *
 * Notes:
 * - API shapes below are placeholders where OpenCode plugin APIs are uncertain.
 * - This scaffold does not claim native skill hot-swap.
 * - Skills are exposed as path-discovery references only.
 */

import { spawn } from "node:child_process";

interface RuntimeBundle {
  tool: string;
  fingerprint: string;
  injection: {
    instructions: Array<{ relativePath: string; content: string }>;
    rules: Array<{ relativePath: string; content: string }>;
    skills: Array<{ name: string; path: string; sourcePath: string }>;
  };
  capabilities: {
    runtimeMode: "native-runtime" | "experimental-runtime" | "filesystem-activation";
    modelInjection: { instructions: boolean; rules: boolean };
    skillPathDiscovery: boolean;
    nativeSkillHotSwap: boolean;
  };
}

type SessionRuntimeState = {
  fingerprint?: string;
  bundle?: RuntimeBundle;
};

// Placeholder/uncertain plugin API. Replace with actual OpenCode interfaces.
interface OpenCodePluginApi {
  // Possible session lifecycle hook (name/signature may differ).
  onSessionStart?: (handler: (ctx: { cwd: string; state: SessionRuntimeState }) => Promise<void>) => void;
  // Possible system prompt composition hook (name/signature may differ).
  onSystemPrompt?: (handler: (ctx: { state: SessionRuntimeState }) => string | Promise<string>) => void;
  // Possible skill discovery registration hook (name/signature may differ).
  registerSkillDiscoveryPath?: (path: string) => void;
}

export function registerLoadoutsRuntimeScaffold(api: OpenCodePluginApi): void {
  if (!api.onSessionStart || !api.onSystemPrompt) {
    return;
  }

  api.onSessionStart(async ({ cwd, state }) => {
    const names = ["base"]; // Replace with user/session-selected runtime loadouts.
    const bundle = await compileRuntimeBundleViaCli(names, cwd);

    state.bundle = bundle;
    state.fingerprint = bundle.fingerprint;

    if (bundle.capabilities.skillPathDiscovery && api.registerSkillDiscoveryPath) {
      for (const skill of bundle.injection.skills) {
        api.registerSkillDiscoveryPath(skill.path);
      }
    }
  });

  api.onSystemPrompt(({ state }) => {
    const bundle = state.bundle;
    if (!bundle) return "";

    // Either render your own system block from bundle fields,
    // or call `loadouts runtime ... --system-block` in environments that prefer text passthrough.
    return renderRuntimeSystemBlockText(bundle);
  });
}

async function compileRuntimeBundleViaCli(names: string[], cwd: string): Promise<RuntimeBundle> {
  const args = ["runtime", ...names, "--tool", "opencode", "--json", "--local"];
  const { stdout } = await execFile("loadouts", args, cwd);
  return JSON.parse(stdout) as RuntimeBundle;
}

function renderRuntimeSystemBlockText(bundle: RuntimeBundle): string {
  const lines: string[] = [];
  lines.push("[loadout-runtime:v1]");
  lines.push(`tool: ${bundle.tool}`);
  lines.push(`fingerprint: ${bundle.fingerprint}`);
  lines.push("");
  lines.push("## Instructions (Model Injected)");

  if (bundle.injection.instructions.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of bundle.injection.instructions) {
      lines.push(`### ${item.relativePath}`);
      lines.push(item.content);
      lines.push("");
    }
  }

  lines.push("## Rules (Model Injected)");
  if (bundle.injection.rules.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of bundle.injection.rules) {
      lines.push(`### ${item.relativePath}`);
      lines.push(item.content);
      lines.push("");
    }
  }

  lines.push("## Skills (Path Discovery Only)");
  lines.push("Native skill hot-swap is not available in runtime v1.");
  for (const skill of bundle.injection.skills) {
    lines.push(`- ${skill.name}`);
    lines.push(`  path: ${skill.path}`);
  }

  return lines.join("\n").trimEnd() + "\n";
}

function execFile(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`loadouts runtime failed (${code}): ${stderr || stdout}`));
    });
  });
}
