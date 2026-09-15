/**
 * Embedded host build:
 * - Pi (and any host with src/tui/hosts/<host>/embed-entry.ts(x)) bundles to
 *   bundled/embedded/<host>/loadouts-runtime.<ext>; Pi is mirrored into an
 *   extension package directory at bundled/extensions/loadouts-runtime/.
 * - OpenCode V2 builds a plugin *package directory* at
 *   bundled/opencode/plugins/loadouts/ from src/tui/hosts/opencode/index.ts
 *   (server entry -> index.js) and tui.tsx (TUI entry -> tui.js), with a
 *   package.json exposing "." and "./tui". Both entries must exist; a missing
 *   entry fails the build.
 * - src/tui/core and src/tui/skins are inlined; host runtime libraries stay external.
 *
 * JSX: every TSX/JSX file under src/ is pre-transformed with Babel
 * (babel-preset-solid, generate: "universal", moduleName: "@opentui/solid")
 * before esbuild sees it. esbuild's automatic jsx-runtime emits eager
 * `jsx(Comp, { when: ... })` props, which loses reactive getters on props
 * (e.g. `<Show when={...}>`) that the OpenTUI universal renderer requires;
 * the Babel transform emits `get when() {}` accessors instead. This mirrors
 * @opentui/solid's own scripts/solid-transform.js.
 */

import { transformAsync } from "@babel/core";
// CJS presets, no bundled types.
import tsPreset from "@babel/preset-typescript";
import solidPreset from "babel-preset-solid";
import { build } from "esbuild";
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const hostsRoot = path.join(repoRoot, "src", "tui", "hosts");
const bundledRoot = path.join(repoRoot, "bundled", "embedded");
const opencodeHostRoot = path.join(repoRoot, "src", "tui", "hosts", "opencode");
const opencodePluginDir = path.join(repoRoot, "bundled", "opencode", "plugins", "loadouts");

const hostExternals = [
  "@earendil-works/pi-tui",
  "@earendil-works/pi-coding-agent",
  "@opentui/core",
  "@opentui/solid",
  "@opentui/keymap",
  "@opencode/plugin",
  "@opencode/plugin/*",
  "@opencode/client",
  "@opencode/client/*",
  "@opencode/theme",
  "solid-js",
  "solid-js/*",
  "node:*",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

// Preserve bare Solid imports: OpenCode supplies those exact aliases from its
// own reactive runtime. dist/solid.js subpaths are not provided by its loader.

const TS_PATTERN = /\.[cm]?tsx?$/;
const JSX_PATTERN = /\.[cm]?[jt]sx$/;
const srcRoot = path.join(repoRoot, "src");
const babelCache = new Map();

/**
 * Pre-transforms src/**\/*.{ts,tsx,jsx} with Babel so JSX is compiled by
 * babel-preset-solid (universal generate, @opentui/solid module) instead of
 * esbuild's automatic jsx-runtime, which emits eager props and loses
 * reactive getters. Output is plain JS (loader: "js").
 */
const solidBabelPlugin = {
  name: "solid-babel",
  setup(build) {
    build.onLoad({ filter: /\.(tsx|ts|jsx)$/ }, async (args) => {
      if (args.path.includes("node_modules") || !args.path.startsWith(srcRoot + path.sep)) {
        return undefined;
      }
      const { mtimeMs } = await stat(args.path);
      const cached = babelCache.get(args.path);
      if (cached && cached.mtimeMs === mtimeMs) return { contents: cached.code, loader: "js" };

      const source = await readFile(args.path, "utf8");
      const presets = [];
      if (JSX_PATTERN.test(args.path)) {
        presets.push([solidPreset, { moduleName: "@opentui/solid", generate: "universal" }]);
      }
      if (TS_PATTERN.test(args.path)) {
        presets.push([tsPreset, {}]);
      }
      if (presets.length === 0) return undefined;

      const result = await transformAsync(source, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets,
      });
      const code = result?.code ?? source;
      babelCache.set(args.path, { mtimeMs, code });
      return { contents: code, loader: "js" };
    });
  },
};

function esbuildOptions() {
  return {
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    // Fallback only: src/ JSX is already compiled by solidBabelPlugin.
    jsx: "automatic",
    jsxImportSource: "@opentui/solid",
    sourcemap: false,
    external: hostExternals,
    plugins: [solidBabelPlugin],
    logLevel: "silent",
  };
}

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

async function bundle(entry) {
  await mkdir(path.dirname(entry.outputPath), { recursive: true });
  console.log(`[embedded] ${path.relative(repoRoot, entry.inputPath)} -> ${path.relative(repoRoot, entry.outputPath)}`);
  await build({
    entryPoints: [entry.inputPath],
    outfile: entry.outputPath,
    ...esbuildOptions(),
  });

  if (entry.hostName === "pi") {
    await writePiExtensionDirectory(entry.outputPath);
  }
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

/**
 * Bundle the OpenCode V2 plugin package directory.
 * Server entry (index.ts) -> index.js; TUI entry (tui.tsx) -> tui.js.
 * Both entries are required: a missing source fails the build so the plugin
 * directory is never shipped stale or partial.
 */
async function buildOpenCodePluginDir() {
  const entries = [
    { source: path.join(opencodeHostRoot, "index.ts"), output: path.join(opencodePluginDir, "index.js") },
    { source: path.join(opencodeHostRoot, "tui.tsx"), output: path.join(opencodePluginDir, "tui.js") },
  ];
  const missing = [];
  for (const entry of entries) {
    if (!(await exists(entry.source))) missing.push(path.relative(repoRoot, entry.source));
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing OpenCode plugin entries: ${missing.join(", ")}. ` +
        `Expected src/tui/hosts/opencode/{index.ts,tui.tsx}; refusing to bundle a partial plugin.`
    );
  }

  await mkdir(opencodePluginDir, { recursive: true });
  await writeFile(
    path.join(opencodePluginDir, "package.json"),
    `${JSON.stringify({
      type: "module",
      exports: {
        ".": "./index.js",
        "./tui": "./tui.js",
      },
      // Local server plugin directories do not install dependencies in V2.
      // Bundle server libraries; TUI runtime imports are supplied by OpenCode.
      name: "@loadouts/opencode",
      version: "0.3.0",
    }, null, 2)}\n`,
    "utf8"
  );
  console.log(`[embedded] wrote ${path.relative(repoRoot, path.join(opencodePluginDir, "package.json"))}`);

  for (const entry of entries) {
    console.log(`[embedded] ${path.relative(repoRoot, entry.source)} -> ${path.relative(repoRoot, entry.output)}`);
    await build({
      entryPoints: [entry.source],
      outfile: entry.output,
      ...esbuildOptions(),
      external: [...hostExternals.filter((name) => !name.startsWith("@opencode/")), "@opencode/plugin/tui"],
    });
  }
}

async function main() {
  const entries = await discoverEmbedEntries();
  for (const entry of entries) {
    await bundle(entry);
  }
  if (entries.length > 0) {
    console.log(`[embedded] Built ${entries.length} embedded artifact(s).`);
  } else {
    console.log("[embedded] No embed entries found under src/tui/hosts/*/embed-entry.ts(x).");
  }

  await buildOpenCodePluginDir();
}

main().catch((error) => {
  console.error("[embedded] Build failed:");
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
