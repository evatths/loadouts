import { runRuntime } from "../../../cli/commands/runtime.js";
import { renderRuntimeSystemBlock } from "../../../core/runtime.js";
import type { EquipOptions, EquipResult, SessionEquipment, SessionStatus } from "../../../integrations/opencode/session.js";

/** Pi state belongs to an actual Pi session ID, never a process-wide 'pi' key. */
export class PiSessionActivator implements SessionEquipment {
  private readonly states = new Map<string, { status: SessionStatus; block: string }>();
  constructor(private readonly cwd: string, private readonly changed: (status?: SessionStatus) => void) {}

  async equip(sessionID: string, names: string[], options: EquipOptions): Promise<EquipResult> {
    const result = await runRuntime(names, { tool: "pi", global: options.scope === "global", local: options.scope === "project" }, this.cwd);
    const status: SessionStatus = {
      version: 1, names: result.loadoutNames, scope: options.scope,
      fingerprint: result.bundle.fingerprint, equippedAt: new Date().toISOString(),
      keys: [], skills: result.bundle.injection.skills.map((skill) => skill.name), priorPermissions: [], appliedPermissions: [],
    };
    this.states.set(sessionID, { status, block: renderRuntimeSystemBlock(result.bundle) });
    this.changed(status);
    return { status, warnings: [...result.sourceWarnings, ...result.bundle.diagnostics.map((item) => item.message)] };
  }

  async unequip(sessionID: string): Promise<{ warnings: string[] }> {
    this.states.delete(sessionID); this.changed(); return { warnings: [] };
  }
  async status(sessionID: string) { return this.states.get(sessionID)?.status; }
  systemBlock(sessionID: string): string { return this.states.get(sessionID)?.block ?? ""; }
}
