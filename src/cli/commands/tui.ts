import { Command } from "commander";

export const tuiCommand = new Command("tui")
  .alias("ui")
  .description("Open the interactive loadouts dashboard")
  .action(async () => {
    if (!supportsPiTuiNode()) {
      console.error(
        "loadouts tui needs Node.js 22.19 or newer because its terminal UI engine requires it.\n" +
        `Current Node.js: ${process.versions.node}\n` +
        "The rest of the loadouts CLI still supports Node.js 18+. Upgrade Node to use the dashboard."
      );
      process.exitCode = 1;
      return;
    }

    const { runStandaloneTui } = await import("../../tui/hosts/standalone.js");
    await runStandaloneTui();
  });

function supportsPiTuiNode(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}
