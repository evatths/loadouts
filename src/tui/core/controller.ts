import { executeEffect } from "./actions.js";
import { loadDashboardData, withSessionEquipment } from "./data.js";
import { createInitialModel, type EquipLayer, type Model } from "./model.js";
import { update } from "./update.js";
import { view } from "./view.js";
import type { Intent } from "./intent.js";
import type { HostContext } from "./host.js";

/** Shared lifecycle for all skins. Effects are serialized by the reducer's busy state. */
export class DashboardController {
  model: Model;
  private disposed = false;
  private refreshVersion = 0;

  constructor(private readonly options: {
    cwd: string;
    session?: HostContext["session"];
    layer?: EquipLayer;
    changed: () => void;
    exit: () => void;
    edit: (file: string) => Promise<void>;
  }) {
    this.model = createInitialModel({ rows: [], active: [], tools: [], issues: [], warnings: [] }, {
      layer: options.layer ?? (options.session ? "session" : "project"),
      layers: options.session ? ["global", "project", "session"] : ["global", "project"],
    });
  }

  get spec() { return view(this.model); }
  get session() { return this.options.session; }
  dispose() { this.disposed = true; this.refreshVersion++; }

  async selectSession(session: HostContext["session"]): Promise<void> {
    if (this.model.busy) return;
    this.options.session = session;
    this.model = { ...this.model, undo: undefined, layer: session ? "session" : "project", layers: session ? ["global", "project", "session"] : ["global", "project"] };
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const version = ++this.refreshVersion;
    try {
      const data = await loadDashboardData(this.options.cwd);
      const session = this.options.session;
      const status = session ? await session.activator.status(session.id) : undefined;
      if (this.disposed || version !== this.refreshVersion) return;
      const next = createInitialModel(withSessionEquipment(data, status), {
        layer: this.model.layer, layers: this.model.layers, scope: status?.scope ?? this.model.scope,
      });
      this.model = { ...this.model, rows: next.rows, sections: next.sections, scope: next.scope };
    } catch (error) {
      this.model = { ...this.model, lastResult: { variant: "error", text: error instanceof Error ? error.message : String(error) } };
    }
    if (!this.disposed) this.options.changed();
  }

  async dispatch(intent: Intent): Promise<void> {
    if (this.disposed) return;
    if ((intent.t === "quit" || intent.t === "closeOverlay") && this.model.overlay) intent = { t: "closeOverlay" };
    else if (intent.t === "closeOverlay" && !this.model.filtering) intent = { t: "quit" };
    const result = update(this.model, intent);
    this.model = result.model;
    if (this.model.quitRequested) { this.options.exit(); return; }
    this.options.changed();
    if (!result.effect) return;
    const effect = result.effect;
    let done: Intent;
    try {
      if (effect.t === "editFile") await this.options.edit(effect.path);
      done = await executeEffect(effect, { cwd: this.options.cwd, session: this.options.session });
    } catch (error) {
      done = { t: "effectDone", effect: effect.t, ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    if (this.disposed) return;
    this.model = update(this.model, done).model;
    // Re-read persisted state after effects, including failures and external changes.
    if (effect.t !== "plan") await this.refresh();
    this.options.changed();
  }
}
