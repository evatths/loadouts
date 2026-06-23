import {
  clearRuntimeSessionState,
  getRuntimeSessionState,
  renderInjectedSystemBlock,
  setRuntimeSessionState,
} from "../../../integrations/opencode-runtime/state.js";
import { CliRuntimeBridge } from "../../../integrations/opencode-runtime/bridge.js";
import type { RuntimeSessionStore } from "../../../integrations/opencode-runtime/types.js";
import type { RuntimeInjector, RuntimeStatus } from "../../core/host.js";

export const PI_RUNTIME_SESSION_ID = "pi";

export interface PiRuntimeInjectorOptions {
  cwd: string;
  store: RuntimeSessionStore;
  sessionID?: string;
  scopeState?: PiRuntimeScopeState;
  onChange?: (status: RuntimeStatus) => void;
}

export interface PiRuntimeScopeState {
  scope: RuntimeStatus["scope"];
}

export class PiRuntimeInjector implements RuntimeInjector {
  private readonly bridge = new CliRuntimeBridge({ tool: "pi" });
  private readonly cwd: string;
  private readonly store: RuntimeSessionStore;
  private readonly sessionID: string;
  private readonly scopeState: PiRuntimeScopeState;
  private readonly onChange?: (status: RuntimeStatus) => void;

  constructor(options: PiRuntimeInjectorOptions) {
    this.cwd = options.cwd;
    this.store = options.store;
    this.sessionID = options.sessionID ?? PI_RUNTIME_SESSION_ID;
    this.scopeState = options.scopeState ?? { scope: "local" };
    this.onChange = options.onChange;
  }

  async activate(names: string[], scope: RuntimeStatus["scope"]): Promise<void> {
    const compiled = await this.bridge.compile(names, scope, this.cwd);
    this.scopeState.scope = scope;
    setRuntimeSessionState(this.store, this.sessionID, {
      activeNames: names,
      bundle: compiled.bundle,
      systemBlock: compiled.systemBlock,
      activatedAt: new Date().toISOString(),
    });
    this.onChange?.(this.status());
  }

  async deactivate(): Promise<void> {
    clearRuntimeSessionState(this.store, this.sessionID);
    this.onChange?.(this.status());
  }

  status(): RuntimeStatus {
    const state = getRuntimeSessionState(this.store, this.sessionID);
    return {
      active: state?.activeNames ?? [],
      scope: this.scopeState.scope,
      updatedAt: state?.activatedAt,
    };
  }
}

export function piRuntimeSystemBlock(store: RuntimeSessionStore, sessionID = PI_RUNTIME_SESSION_ID): string {
  return renderInjectedSystemBlock(getRuntimeSessionState(store, sessionID));
}

export function piRuntimeResourcePaths(store: RuntimeSessionStore, sessionID = PI_RUNTIME_SESSION_ID): {
  skillPaths: string[];
  promptPaths: string[];
  themePaths: string[];
} {
  const state = getRuntimeSessionState(store, sessionID);
  return {
    skillPaths: state?.bundle.injection.skills.map((skill) => skill.path) ?? [],
    promptPaths: [],
    themePaths: [],
  };
}
