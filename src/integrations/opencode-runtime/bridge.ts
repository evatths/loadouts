import { spawn } from "node:child_process";
import { renderRuntimeSystemBlock } from "../../core/runtime.js";
import type { RuntimeBundle } from "../../core/runtime.js";
import type { BridgeCompileResult, RuntimeBridge, RuntimeScope } from "./types.js";

interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface CliRuntimeBridgeOptions {
  bin?: string;
}

function scopeFlag(scope: RuntimeScope): string {
  return scope === "global" ? "--global" : "--local";
}

export class CliRuntimeBridge implements RuntimeBridge {
  private readonly bin: string;

  constructor(options: CliRuntimeBridgeOptions = {}) {
    this.bin = options.bin ?? "loadouts";
  }

  async compile(names: string[], scope: RuntimeScope, cwd: string): Promise<BridgeCompileResult> {
    const args = ["runtime", ...names, "--tool", "opencode", "--json", scopeFlag(scope)];
    const { stdout } = await this.exec(args, cwd);
    const bundle = JSON.parse(stdout) as RuntimeBundle;
    return {
      bundle,
      systemBlock: renderRuntimeSystemBlock(bundle),
    };
  }

  list(scope: RuntimeScope, cwd: string): Promise<string> {
    return this.execText(["list", scopeFlag(scope)], cwd);
  }

  info(names: string[], scope: RuntimeScope, cwd: string): Promise<string> {
    return this.execText(["info", ...names, scopeFlag(scope)], cwd);
  }

  private async execText(args: string[], cwd: string): Promise<string> {
    const { stdout } = await this.exec(args, cwd);
    return stdout;
  }

  private exec(args: string[], cwd: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = stderr.trim() || stdout.trim() || `process exited with code ${code}`;
        reject(new Error(`loadouts command failed: ${detail}`));
      });
    });
  }
}
