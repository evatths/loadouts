/** Product acceptance against an isolated OpenCode 2.3.2 service and loopback model.
 * Build first; set OPENCODE_BIN to the matching executable if it is not on PATH. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
const binary = process.env.OPENCODE_BIN ?? "opencode";
const searchPath = process.env.PATH;
const cliFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");
const temp = path.join(os.tmpdir(), "opencode");
await fs.mkdir(temp, { recursive: true });
const scratch = await fs.realpath(await fs.mkdtemp(path.join(temp, "private-e2e-")));
const home = path.join(scratch, "home");
const repo = path.join(scratch, "ml-ops");
const parent = path.join(repo, "pipelines");
const child = path.join(parent, "data-lens");
const sibling = path.join(parent, "reports");
const deep = path.join(child, "src/deep");
const worktree = path.join(repo, ".worktrees/linked");
const linked = path.join(worktree, "pipelines/data-lens");
const globalRoot = path.join(home, ".config/loadouts");
// Service.ensure inherits process.env; keep neither credentials nor real configs.
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
  PATH: searchPath, HOME: home, TMPDIR: path.join(scratch, "tmp"),
  XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(scratch, "data"),
  XDG_STATE_HOME: path.join(scratch, "state"), XDG_CACHE_HOME: path.join(scratch, "cache"),
  XDG_RUNTIME_DIR: path.join(scratch, "runtime"), XDG_CONFIG_DIRS: path.join(scratch, "config-dirs"),
  XDG_DATA_DIRS: path.join(scratch, "data-dirs"), PROBE_KEY: "dummy", NO_PROXY: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  EDITOR: path.join(scratch, "editor"), NO_COLOR: "1", NO_UPDATE_NOTIFIER: "1", CI: "1",
});
for (const key of ["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS"]) await fs.mkdir(process.env[key], { recursive: true });
const { OpenCode } = await import("@opencode/client");
const { Service } = await import("@opencode/client/service");
const serviceFile = path.join(process.env.XDG_STATE_HOME, "opencode/service.json");
const write = async (name, text) => { await fs.mkdir(path.dirname(name), { recursive: true }); await fs.writeFile(name, text); };
const skill = (name, marker) => `---\nname: ${name}\ndescription: ${name} fixture\n---\n${marker}\n`;
const run = (command, args, cwd) => spawnSync(command, args, { cwd, env: process.env, encoding: "utf8", timeout: 45000 });
const git = (cwd, ...args) => {
  const result = run("git", ["-C", cwd, ...args], cwd);
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};
// Hash file bytes and record symlinks/modes; only Git's internals and the
// explicitly private store are excluded. Capture index flags and Git controls separately.
async function tree(root, skip, relative = "") {
  if (skip(relative)) return [];
  let stat;
  try { stat = await fs.lstat(path.join(root, relative)); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  if (stat.isDirectory()) {
    const names = (await fs.readdir(path.join(root, relative))).sort();
    return (await Promise.all(names.map((name) => tree(root, skip, path.join(relative, name))))).flat();
  }
  const value = stat.isSymbolicLink() ? `link:${await fs.readlink(path.join(root, relative))}`
    : `sha256:${createHash("sha256").update(await fs.readFile(path.join(root, relative))).digest("hex")}`;
  return [[relative, stat.mode & 0o7777, value]];
}
const optionalFile = async (file) => { try { return (await fs.readFile(file)).toString("base64"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
async function snapshot() {
  const gitState = async (cwd) => ({
    index: git(cwd, "ls-files", "--stage", "-v", "-z"), flags: [...git(cwd, "ls-files", "--debug").matchAll(/flags: ([0-9a-f]+)/g)].map((match) => match[1]),
    status: git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all"),
    config: git(cwd, "config", "--local", "--list", "--null"),
    exclude: await optionalFile(path.resolve(cwd, git(cwd, "rev-parse", "--git-path", "info/exclude").trim())),
    sparse: await optionalFile(path.resolve(cwd, git(cwd, "rev-parse", "--git-path", "info/sparse-checkout").trim())),
  });
  return {
    checkout: await tree(repo, (name) => name === ".git"),
    global: await tree(home, (name) => name === ".config/loadouts/repos"),
    main: await gitState(repo), linked: await gitState(worktree),
  };
}
let baseline;
async function command(cwd, args, shouldFail = false) {
  const result = run(process.execPath, [cliFile, ...args], cwd);
  if (shouldFail) assert.ok(result.status !== 0 && result.status !== null, `Expected refusal: ${args.join(" ")}`);
  else assert.equal(result.status, 0, `loadouts ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  if (baseline) assert.deepEqual(await snapshot(), baseline, `Checkout/global changed during: ${args.join(" ")}`);
  return shouldFail ? result.stdout + result.stderr : result.stdout;
}
const cli = (cwd, ...args) => command(cwd, args);
const json = async (cwd, ...args) => JSON.parse(await cli(cwd, ...args, "--json"));
const selection = async (cwd) => (await json(cwd, "status")).selection;
const requests = [];
let calls = [];
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push(JSON.parse(body));
  await fs.writeFile(path.join(scratch, "requests.json"), JSON.stringify(requests, null, 2));
  const id = calls.shift();
  const delta = id ? { tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: "skill", arguments: JSON.stringify({ id }) } }] } : { content: "done" };
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (chunk) => res.write(`data: ${JSON.stringify({ id: "proof", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, ...chunk }] })}\n\n`);
  send({ delta, finish_reason: null });
  send({ delta: {}, finish_reason: id ? "tool_calls" : "stop" });
  res.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let client;
const connect = async () => {
  const endpoint = await Service.ensure({ file: serviceFile, env: process.env, version: "2.3.2", command: [binary, "serve", "--service", "--hostname", "127.0.0.1", "--port", "0"] });
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
};
try {
  assert.match(run(binary, ["--version"], scratch).stdout, /(?:^|\s)v?2\.3\.2\s*$/);
  await write(process.env.EDITOR, '#!/bin/sh\nprintf "%s\\n" "$EDIT_VALUE" > "$1"\n');
  await fs.chmod(process.env.EDITOR, 0o755);
  await write(path.join(home, ".config/opencode/opencode.json"), JSON.stringify({ providers: { probe: { name: "Probe", env: ["PROBE_KEY"], package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${server.address().port}/v1` }, models: { m: { name: "M" } } } } }));
  await write(path.join(globalRoot, "loadouts.yaml"), `version: '1'\ntools: [opencode]\nsources: [${JSON.stringify(path.join(scratch, "shared"))}]\n`);
  await write(path.join(scratch, "shared/.loadouts/loadouts/caveman.yaml"), "name: caveman\ninclude: [instructions/AGENTS.global-caveman.md]\n");
  await write(path.join(scratch, "shared/.loadouts/instructions/AGENTS.global-caveman.md"), "PROOF_GLOBAL_CAVEMAN\n");
  await write(path.join(globalRoot, "loadouts/global-proof.yaml"), "name: global-proof\ninclude: [instructions/AGENTS.global-proof.md, skills/global-skill]\n");
  await write(path.join(globalRoot, "instructions/AGENTS.global-proof.md"), "PROOF_GLOBAL_INSTRUCTION\n");
  await write(path.join(globalRoot, "skills/global-skill/SKILL.md"), skill("global-skill", "PROOF_GLOBAL_SKILL"));
  await cli(home, "activate", "opencode-runtime", "-g");
  await cli(home, "activate", "global-proof", "-g");
  const globalState = JSON.parse(await fs.readFile(path.join(globalRoot, ".state.json"), "utf8"));
  assert.ok(globalState.active.includes("opencode-runtime") && globalState.active.includes("global-proof"));
  await write(path.join(repo, "root-guidance.md"), `PROOF_ROOT_INSTRUCTION\nInstructions from: ${path.join(parent, "AGENTS.md")}\nThis is ordinary root content.\n`);
  await fs.symlink("root-guidance.md", path.join(repo, "AGENTS.md"));
  await write(path.join(parent, "AGENTS.md"), "PROOF_MIDDLE_INSTRUCTION\n");
  await write(path.join(parent, "CLAUDE.md"), "PROOF_MIDDLE_FALLBACK\n");
  await write(path.join(child, "AGENTS.md"), "PROOF_CHILD_INSTRUCTION\n");
  await write(path.join(sibling, "AGENTS.md"), "PROOF_SIBLING_INSTRUCTION\n");
  await write(path.join(deep, "index.txt"), "plain directory\n");
  await write(path.join(repo, ".loadouts/loadouts.yaml"), "version: '1'\n");
  await write(path.join(repo, ".loadouts/loadouts/tracked.yaml"), "name: tracked\ninclude: []\n");
  await write(path.join(repo, ".gitignore"), "ignored.txt\n");
  await write(path.join(repo, "opencode.json"), "{}\n");
  for (const [dir, name, marker] of [
    [repo, ".opencode/skills/root-skill", "ROOT"], [parent, ".opencode/skills/team", "TEAM"],
    [parent, ".opencode/skills/other", "OTHER"], [parent, ".claude/skills/alias-skill", "ALIAS"],
    [child, ".agents/skills/child-skill", "CHILD"],
  ]) await write(path.join(dir, name, "SKILL.md"), skill(path.basename(name), `PROOF_${marker}_SKILL`));
  for (const name of ["dirty.txt", "staged.txt", "flagged.txt"]) await write(path.join(repo, name), "committed\n");
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "-c", "user.name=Proof", "-c", "user.email=proof@example.invalid", "commit", "-qm", "fixture");
  git(repo, "worktree", "add", "-qb", "private-e2e", worktree);
  await write(path.join(repo, "dirty.txt"), "unstaged edit\n");
  await write(path.join(repo, "staged.txt"), "staged edit\n");
  await write(path.join(repo, "untracked.txt"), "untracked\n");
  await write(path.join(repo, "ignored.txt"), "ignored baseline\n");
  git(repo, "add", "staged.txt");
  git(repo, "update-index", "--skip-worktree", "flagged.txt");
  assert.match(git(repo, "ls-files", "-s", "AGENTS.md"), /^120000 /);
  client = await connect();
  baseline = await snapshot();
  await cli(child, "init", "--private");
  const listed = await json(child, "list");
  for (const id of ["team:.", "team:pipelines", "team:pipelines/data-lens"]) assert.ok(listed.loadouts.some((row) => row.id === id), `list ${id}`);
  const info = await json(child, "info", "pipelines");
  const teamRef = info.items.find((item) => item.relativePath === "repo:pipelines/.opencode/skills/team")?.relativePath;
  assert.ok(teamRef, "info must provide the team artifact ref");
  await cli(child, "create", "caveman", "--no-edit");
  await cli(child, "create", "broken", "--no-edit");
  await cli(child, "activate", "broken");
  await write(path.join(globalRoot, "repos/ml-ops/pipelines/data-lens/.loadouts/loadouts/broken.yaml"), "name: broken\ninclude: [instructions/missing.md]\n");
  assert.match(await command(child, ["activate", "broken"], true), /missing/i);
  await cli(child, "deactivate", "broken");
  assert.ok(!(await selection(child)).includes("broken"));
  await cli(child, "clear");
  await cli(child, "instructions", "init", "caveman");
  process.env.EDIT_VALUE = "PROOF_PERSONAL_INSTRUCTION";
  await cli(child, "instructions", "edit", "caveman");
  await cli(child, "add-to", "caveman", "instructions/AGENTS.caveman.md", teamRef);
  await cli(child, "add-to", "caveman", "repo:pipelines/.opencode/skills/other", "--tools", "cursor");
  assert.equal(await selection(child), null);
  await cli(child, "activate", "caveman");
  const selectedBeforeRefusal = await selection(child);
  const privateBeforeRefusal = await tree(path.join(globalRoot, "repos"), () => false);
  assert.match(await command(child, ["activate", "missing-loadout"], true), /missing-loadout/i);
  assert.match(await command(child, ["add-to", "caveman", "repo:../outside"], true), /repo:\.\.\/outside/i);
  assert.match(await command(child, ["instructions", "import", path.join(repo, "AGENTS.md"), "--keep"], true), /not supported|private/i);
  await cli(child, "deactivate", "pipelines", "--dry-run");
  assert.deepEqual(await selection(child), selectedBeforeRefusal);
  assert.deepEqual(await tree(path.join(globalRoot, "repos"), () => false), privateBeforeRefusal);
  process.chdir(child);
  const session = async (directory, title) => client.session.create({ location: { directory }, title, model: { providerID: "probe", id: "m" } });
  const prompt = async (sessionID, toolCalls = []) => {
    const start = requests.length;
    calls = [...toolCalls];
    await client.session.prompt({ sessionID, text: "Product acceptance probe" });
    await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(45000) });
    assert.ok(requests[start], "prompt did not reach the loopback model");
    assert.equal(calls.length, 0, "requested skill calls did not execute");
    assert.deepEqual(await snapshot(), baseline, "A model turn changed checkout or global outputs");
    return requests.slice(start);
  };
  // The OpenAI-compatible provider lowers host system records as tagged user updates.
  // Only accept updates immediately before this prompt, never older user/tool history.
  const updates = (turn) => { const m = turn[0].messages, end = m.findLastIndex((x) => x.role === "user" && x.content === "Product acceptance probe"); assert.ok(end >= 0); const start = m.slice(0, end).findLastIndex((x) => x.role === "assistant"); return m.slice(start + 1, end).filter((x) => x.role === "user" && typeof x.content === "string" && /^<system-update>\n[\s\S]*\n<\/system-update>$/.test(x.content)); };
  const system = (turn) => JSON.stringify(turn[0].messages.filter((message) => message.role === "system" || message.role === "developer"));
  const current = (turn) => system(turn) + JSON.stringify(updates(turn));
  const removed = async (id, turn, key) => { assert.ok(!(await client.session.instructions.entry.list({ sessionID: id })).some((entry) => entry.key === key)); const u = updates(turn), i = u.findLastIndex((x) => x.content.includes(`The context under "${key}" no longer applies. Disregard it.`)); assert.ok(i >= 0, `No current removal notice for ${key}`); const later = turn[0].messages.slice(turn[0].messages.indexOf(u[i]) + 1).filter((x) => x.role === "system" || x.role === "developer"); assert.ok(!JSON.stringify([u.slice(i + 1), later]).includes("PROOF_PERSONAL_UPDATED")); };
  const contains = (text, present, absent = []) => {
    for (const value of present) assert.ok(text.includes(value), `Missing ${value}`);
    for (const value of absent) assert.ok(!text.includes(value), `Unexpected ${value}`);
  };
  const follower = await session(child, "Project follower");
  const globalExplicit = await session(child, "Global shadow resolution");
  await cli(child, "session", "equip", "caveman", "-g", "--session", globalExplicit.id);
  contains(current(await prompt(globalExplicit.id)), ["PROOF_GLOBAL_CAVEMAN", "PROOF_GLOBAL_INSTRUCTION", "<id>global-skill</id>"], ["PROOF_PERSONAL_INSTRUCTION"]);
  await cli(child, "session", "unequip", "--session", globalExplicit.id);
  await client.session.instructions.entry.put({ sessionID: follower.id, key: "foreign", value: "PROOF_FOREIGN_ENTRY" });
  const foreign = [{ action: "shell", resource: "git push *", effect: "deny" }];
  await client.session.update({ sessionID: follower.id, permissions: foreign });
  const first = current(await prompt(follower.id));
  contains(first, ["PROOF_GLOBAL_INSTRUCTION", "PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "PROOF_PERSONAL_INSTRUCTION", "PROOF_FOREIGN_ENTRY", "<id>alias-skill</id>", "<id>child-skill</id>"], ["PROOF_MIDDLE_FALLBACK"]);
  assert.equal(first.split("PROOF_PERSONAL_INSTRUCTION").length - 1, 1);
  const plugins = await client.plugin.list({ location: { directory: child } });
  assert.ok(plugins.data.some((plugin) => plugin.id === "loadouts" && plugin.state.status === "active"), "Installed runtime must be active");
  await cli(child, "deactivate", "pipelines");
  process.env.EDIT_VALUE = skill("private-skill", "PROOF_PRIVATE_SKILL");
  await cli(child, "skill", "add", "private-skill", "-d", "Private fixture");
  await cli(child, "add-to", "caveman", "skills/private-skill");
  process.env.EDIT_VALUE = "PROOF_PERSONAL_UPDATED";
  await cli(child, "instructions", "edit", "caveman");
  await cli(child, "sync");
  const filtered = await prompt(follower.id, ["team", "private-skill", "other", "global-skill"]);
  assert.ok(filtered[0].tools.some((tool) => tool.function.name === "skill"));
  contains(current(filtered), ["PROOF_GLOBAL_INSTRUCTION", "PROOF_ROOT_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "PROOF_FOREIGN_ENTRY", "PROOF_PERSONAL_UPDATED", "<id>team</id>", "<id>private-skill</id>", "<id>global-skill</id>"], ["PROOF_MIDDLE_INSTRUCTION", "PROOF_MIDDLE_FALLBACK", "<id>other</id>", "<id>alias-skill</id>"]);
  const results = JSON.stringify(filtered.at(-1).messages.filter((message) => message.role === "tool"));
  contains(results, ["PROOF_TEAM_SKILL", "PROOF_PRIVATE_SKILL", "PROOF_GLOBAL_SKILL", "permission.rejected"], ["PROOF_OTHER_SKILL"]);
  const beforeTeamEdit = baseline;
  await write(path.join(parent, "AGENTS.md"), "PROOF_MIDDLE_FRESH\n\n\n");
  baseline = await snapshot(); // Deliberate team edit is the new baseline for this turn.
  let sawTeamUpdate = false;
  for (let i = 0; i < 8 && !sawTeamUpdate; i++) {
    contains(current(await prompt(follower.id)), ["PROOF_ROOT_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "This is ordinary root content."], ["PROOF_MIDDLE_INSTRUCTION", "PROOF_MIDDLE_FRESH"]);
    sawTeamUpdate = (await client.session.context({ sessionID: follower.id })).some((m) => m.type === "system" && m.metadata?.notice === "instructions" && m.metadata.instructionSources?.includes("core/instructions") && m.text.includes("PROOF_MIDDLE_FRESH"));
    if (!sawTeamUpdate) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(sawTeamUpdate, "OpenCode did not observe the team edit");
  const later = await prompt(follower.id);
  assert.ok(!JSON.stringify(later[0].messages).includes("PROOF_MIDDLE_FRESH"), "Suppressed update reappeared in history");
  await write(path.join(parent, "AGENTS.md"), "PROOF_MIDDLE_INSTRUCTION\n");
  baseline = beforeTeamEdit;
  assert.deepEqual(await snapshot(), baseline);
  assert.ok((await client.session.get({ sessionID: follower.id })).permissions.some((rule) => JSON.stringify(rule) === JSON.stringify(foreign[0])));
  const personalKey = (await client.session.instructions.entry.list({ sessionID: follower.id })).find((entry) => JSON.stringify(entry.value).includes("PROOF_PERSONAL_UPDATED"))?.key;
  assert.ok(personalKey, "selected private instruction must have a keyed entry");
  const explicit = await session(child, "Explicit session");
  await cli(child, "session", "equip", "caveman", "-p", "--session", explicit.id);
  contains(current(await prompt(explicit.id)), ["PROOF_PERSONAL_UPDATED"]);
  await cli(child, "clear");
  assert.equal(await selection(child), null);
  const afterClear = await prompt(follower.id); await removed(follower.id, afterClear, personalKey); contains(current(afterClear), ["PROOF_GLOBAL_INSTRUCTION", "PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "PROOF_FOREIGN_ENTRY"], ["PROOF_MIDDLE_FALLBACK"]);
  await cli(child, "deactivate", "pipelines");
  const firstOff = system(await prompt((await session(child, "First deactivate")).id));
  contains(firstOff, ["PROOF_ROOT_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "PROOF_GLOBAL_INSTRUCTION"], ["PROOF_MIDDLE_INSTRUCTION", "PROOF_MIDDLE_FALLBACK", "PROOF_PERSONAL_UPDATED", "<id>other</id>"]);
  await cli(child, "deactivate", "ml-ops", "data-lens");
  assert.deepEqual(await selection(child), []);
  const empty = system(await prompt((await session(child, "Empty selection")).id));
  contains(empty, ["PROOF_GLOBAL_INSTRUCTION", "<id>global-skill</id>"], ["PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION"]);
  await cli(child, "clear");
  assert.equal(await selection(child), null);
  contains(system(await prompt((await session(child, "Restored defaults")).id)), ["PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION"], ["PROOF_MIDDLE_FALLBACK"]);
  contains(current(await prompt(explicit.id)), ["PROOF_PERSONAL_UPDATED"]); assert.ok((await client.session.instructions.entry.list({ sessionID: explicit.id })).some((entry) => entry.key === personalKey));
  await cli(child, "session", "unequip", "--session", explicit.id);
  const afterUnequip = await prompt(explicit.id); await removed(explicit.id, afterUnequip, personalKey); contains(current(afterUnequip), ["PROOF_GLOBAL_INSTRUCTION", "PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION"], ["PROOF_MIDDLE_FALLBACK"]);
  await cli(parent, "init", "--private");
  await cli(parent, "create", "parent-only", "--no-edit");
  await cli(parent, "instructions", "init", "parent-only");
  process.env.EDIT_VALUE = "PROOF_PARENT_PERSONAL";
  await cli(parent, "instructions", "edit", "parent-only");
  await cli(parent, "add-to", "parent-only", "instructions/AGENTS.parent-only.md");
  await cli(parent, "activate", "parent-only");
  const parentSelection = await selection(parent);
  assert.equal(await selection(child), null);
  await cli(child, "activate", "parent-only");
  assert.deepEqual(await selection(parent), parentSelection);
  assert.deepEqual(await selection(deep), await selection(child));
  contains(current(await prompt((await session(child, "Inherited definition")).id)), ["PROOF_PARENT_PERSONAL"]);
  const childSelection = await selection(child);
  await cli(sibling, "deactivate", "pipelines");
  await cli(repo, "deactivate", "ml-ops");
  assert.ok(!(await selection(sibling)).includes("team:pipelines") && !(await selection(repo)).includes("team:."));
  assert.deepEqual(await selection(child), childSelection);
  assert.deepEqual(await selection(parent), parentSelection);
  assert.equal(await selection(linked), null);
  await cli(linked, "activate", "caveman");
  assert.ok((await selection(linked)).includes("caveman"));
  assert.deepEqual(await selection(child), childSelection);
  contains(current(await prompt((await session(linked, "Linked worktree")).id)), ["PROOF_PERSONAL_UPDATED"]);
  await cli(child, "create", "pipelines", "--no-edit");
  await cli(child, "deactivate", "team:pipelines");
  assert.ok((await json(child, "list")).loadouts.some((row) => row.id === "team:pipelines" && row.name === "team:pipelines"));
  await cli(child, "activate", "pipelines");
  assert.ok((await selection(child)).includes("pipelines") && !(await selection(child)).includes("team:pipelines"));
  await cli(child, "activate", "team:pipelines");
  const beforeRestart = await selection(child);
  await cli(child, "session", "equip", "caveman", "-p", "--session", explicit.id);
  await Service.stop({ file: serviceFile, pty: "clear" });
  client = await connect();
  assert.deepEqual(await selection(child), beforeRestart);
  contains(current(await prompt((await session(child, "Restart follower")).id)), ["PROOF_ROOT_INSTRUCTION", "PROOF_MIDDLE_INSTRUCTION", "PROOF_CHILD_INSTRUCTION", "PROOF_PARENT_PERSONAL"], ["PROOF_PERSONAL_UPDATED"]);
  contains(current(await prompt(explicit.id)), ["PROOF_PERSONAL_UPDATED"]);
  assert.deepEqual(await snapshot(), baseline);
  console.log("✓ Private CLI, real runtime prompts and skill calls, isolation, restart and immutable checkout/global state");
} finally {
  await Service.stop({ file: serviceFile, pty: "clear" }).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  console.log(`Isolated acceptance artifacts: ${scratch}`);
}
