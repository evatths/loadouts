/**
 * Embedded host entry convention:
 * - Author host entrypoints at src/tui/hosts/<host>/embed-entry.ts(x).
 * - This bundles each entry to bundled/embedded/<host>/loadouts-runtime.<ext>, preserving .ts/.tsx extension.
 * - src/tui/core and src/tui/skins are inlined; host runtime libraries stay external.
 */

import { build } from "esbuild";
import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const hostsRoot = path.join(repoRoot, "src", "tui", "hosts");
const bundledRoot = path.join(repoRoot, "bundled", "embedded");

const hostExternals = [
  "@earendil-works/pi-tui",
  "@earendil-works/pi-coding-agent",
  "@opentui/core",
  "@opentui/solid",
  "@opentui/keymap",
  "@opencode-ai/plugin",
  "@opencode-ai/plugin/*",
  "node:*",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverEmbedEntries() {
  const dirents = await readdir(hostsRoot, { withFileTypes: true });
  const entries = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const hostName = dirent.name;
    for (const ext of [".ts", ".tsx"]) {
      const inputPath = path.join(hostsRoot, hostName, `embed-entry${ext}`);
      if (!(await exists(inputPath))) continue;
      const outputPath = path.join(bundledRoot, hostName, `loadouts-runtime${ext}`);
      entries.push({ hostName, inputPath, outputPath, ext });
    }
  }

  return entries;
}

async function bundleEntry(entry) {
  await mkdir(path.dirname(entry.outputPath), { recursive: true });
  console.log(`[embedded] ${path.relative(repoRoot, entry.inputPath)} -> ${path.relative(repoRoot, entry.outputPath)}`);
  await build({
    entryPoints: [entry.inputPath],
    outfile: entry.outputPath,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    jsx: "automatic",
    jsxImportSource: "@opentui/solid",
    sourcemap: false,
    external: hostExternals,
    logLevel: "silent",
  });

  if (entry.hostName === "pi") {
    await writePiExtensionDirectory(entry.outputPath);
  }
  if (entry.hostName === "opencode") {
    await writeOpenCodePluginMirror(entry.outputPath);
  }
}

async function writeOpenCodePluginMirror(singleFileOutputPath) {
  const pluginOutput = path.join(repoRoot, "bundled", "opencode", "plugins", "loadouts-runtime-tui.tsx");
  await mkdir(path.dirname(pluginOutput), { recursive: true });
  await copyFile(singleFileOutputPath, pluginOutput);
  console.log(`[embedded] mirrored -> ${path.relative(repoRoot, pluginOutput)}`);
}

async function writePiExtensionDirectory(singleFileOutputPath) {
  const extensionDir = path.join(repoRoot, "bundled", "extensions", "loadouts-runtime");
  await mkdir(extensionDir, { recursive: true });
  await copyFile(singleFileOutputPath, path.join(extensionDir, "index.ts"));
  await writeFile(
    path.join(extensionDir, "package.json"),
    `${JSON.stringify({
      type: "module",
      dependencies: {
        "@earendil-works/pi-tui": "^0.79.7",
      },
    }, null, 2)}\n`,
    "utf8"
  );
}

async function main() {
  const entries = await discoverEmbedEntries();
  if (entries.length === 0) {
    console.log("[embedded] No embed entries found under src/tui/hosts/*/embed-entry.ts(x); skipping.");
    return;
  }

  for (const entry of entries) {
    await bundleEntry(entry);
  }

  console.log(`[embedded] Built ${entries.length} embedded artifact(s).`);
}

main().catch((error) => {
  console.error("[embedded] Build failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
