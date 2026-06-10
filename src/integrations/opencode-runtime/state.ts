import type { RuntimeSessionState, RuntimeSessionStore } from "./types.js";

export function createRuntimeSessionStore(): RuntimeSessionStore {
  return new Map<string, RuntimeSessionState>();
}

export function getRuntimeSessionState(
  store: RuntimeSessionStore,
  sessionID: string
): RuntimeSessionState | undefined {
  return store.get(sessionID);
}

export function setRuntimeSessionState(
  store: RuntimeSessionStore,
  sessionID: string,
  state: RuntimeSessionState
): void {
  store.set(sessionID, state);
}

export function clearRuntimeSessionState(store: RuntimeSessionStore, sessionID: string): boolean {
  return store.delete(sessionID);
}

export function renderInjectedSystemBlock(state?: RuntimeSessionState): string {
  return state?.systemBlock ?? "";
}

export function renderRuntimeStateSummary(state: RuntimeSessionState): string {
  const names = state.activeNames.join(", ");
  const injected = state.bundle.injection;
  return [
    "runtime: active",
    `loadouts: ${names}`,
    `fingerprint: ${state.bundle.fingerprint}`,
    `injected: instructions=${injected.instructions.length}, rules=${injected.rules.length}, skills=${injected.skills.length}`,
    `activatedAt: ${state.activatedAt}`,
  ].join("\n");
}
