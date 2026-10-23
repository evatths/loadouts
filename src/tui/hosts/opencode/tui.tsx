/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { registerBuiltins } from "../../../builtins/index.js";
import { createPluginAPI } from "../../../core/plugin.js";
import { registry } from "../../../core/registry.js";
import { loadDashboardData } from "../../core/data.js";
import { DashboardController } from "../../core/controller.js";
import { Dashboard } from "../../skins/opentui/Dashboard.js";
import { toOpenTuiTheme } from "../../skins/opentui/theme.js";
import { SessionActivator } from "../../../integrations/opencode/session.js";
import { parseEquipCommand } from "../../../integrations/opencode/command.js";

export default Plugin.define({
  id: "loadouts.tui",
  setup(context) {
    if (!registry.getTool("opencode")) registerBuiltins(createPluginAPI(registry));
    const equipment = new SessionActivator(context.client);
    const [revision, changed] = createSignal(0);
    const notify = () => changed((n) => n + 1);
    const stopInstructions = context.data.on("session.instructions.updated", notify);
    const stopPermissions = context.data.on("session.permissions", notify);
    const location = () => context.location ?? context.data.location.default();
    const sessionID = () => {
      const route = context.ui.router.current();
      if (route.type === "session") return route.sessionID;
      return route.type === "plugin" && route.name === "loadouts" && typeof route.data?.sessionID === "string" ? route.data.sessionID : undefined;
    };
    const toastError = (error: unknown) => context.ui.toast.show({ message: error instanceof Error ? error.message : String(error), variant: "error" });
    const page = context.ui.router.register({
      name: "loadouts",
      render: ({ data }) => <Page sessionID={typeof data?.sessionID === "string" ? data.sessionID : undefined} />,
    });
    const app = context.ui.slot({ append: "app", render: () => {
      context.keymap.layer(() => ({ mode: "global", priority: 10, commands: [{
        id: "loadouts.open", title: "Loadouts dashboard", group: "Loadouts", palette: true,
        bind: typeof context.options.keybind === "string" ? context.options.keybind : "ctrl+l",
        slash: { name: "loadouts", arguments: true },
        run: async (input) => {
          try {
            const command = parseEquipCommand(input);
            const id = sessionID();
            if (command.action === "dashboard") {
              context.ui.router.navigate({ type: "plugin", name: "loadouts", data: { sessionID: id } });
              return;
            }
            if (command.action === "list") {
              const data = await loadDashboardData(location().directory);
              context.ui.toast.show({ message: data.rows.map((row) => `${row.name} (${row.scope})`).join(", ") });
              return;
            }
            if (!id) throw new Error("Open a session first.");
            const result = command.action === "equip" ? await equipment.equip(id, command.names, { scope: command.scope })
              : command.action === "unequip" ? await equipment.unequip(id) : undefined;
            notify();
            const status = await equipment.status(id);
            context.ui.toast.show({ message: `S ${status?.names.join("·") || "—"}${result?.warnings.length ? ` · ${result.warnings.join("; ")}` : ""}`, variant: "success" });
          } catch (error) { toastError(error); }
        },
      }], bindings: ["loadouts.open"] }));
      return null;
    } });
    const footer = context.ui.slot({ append: "prompt.footer.status", render: (props) => <Equipped sessionID={props.sessionID} /> });

    function Page(props: { sessionID?: string }) {
      const [spec, setSpec] = createSignal<DashboardController["spec"]>();
      const controller = new DashboardController({
        cwd: location().directory,
        session: props.sessionID ? { id: props.sessionID, activator: equipment } : undefined,
        changed: () => setSpec(controller.spec),
        exit: () => context.ui.router.navigate(props.sessionID ? { type: "session", sessionID: props.sessionID } : { type: "home" }),
        edit: async (file) => { context.ui.toast.show({ message: `Edit ${file} in your editor.` }); },
      });
      createEffect(() => { revision(); void controller.refresh(); });
      onCleanup(() => controller.dispose());
      return <Dashboard spec={spec() ?? controller.spec} theme={toOpenTuiTheme(context.theme)} onIntent={(intent) => { void controller.dispatch(intent); }} />;
    }

    function Equipped(props: { sessionID?: string }) {
      const [text, setText] = createSignal("G —  P —  S —");
      let version = 0;
      createEffect(() => {
        revision();
        const id = props.sessionID;
        const current = ++version;
        void Promise.all([loadDashboardData(location().directory), id ? equipment.status(id) : undefined]).then(([data, status]) => {
          if (current !== version) return;
          const names = (scope: "global" | "project") => data.rows.filter((row) => row.equipped.includes(scope)).map((row) => row.name).join("·") || "—";
          setText(`G ${names("global")}  P ${names("project")}  S ${status?.names.join("·") || "—"}${status ? ` (${status.fingerprint.replace(/^sha256:/, "").slice(0, 6)})` : ""}`);
        }).catch(toastError);
      });
      onCleanup(() => { version++; });
      return <text fg={context.theme.text.muted}>EQUIPPED {text()}</text>;
    }

    return () => { stopInstructions(); stopPermissions(); page(); app(); footer(); };
  },
});
