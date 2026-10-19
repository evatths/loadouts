/** Run after npm run build. Uses only fresh sessions and a throwaway project.
 *   node scripts/opencode-session-e2e.mjs [--prompts]
 * Optional OPENCODE_E2E_MODEL=provider/model; --prompts incurs three model turns.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { SessionActivator } from "../dist/integrations/opencode/session.js";
import { entryKey } from "../dist/integrations/opencode/delta.js";
import { registerBuiltins } from "../dist/builtins/index.js";
import { registry } from "../dist/core/registry.js";
import { createPluginAPI } from "../dist/core/plugin.js";

registerBuiltins(createPluginAPI(registry));
const endpoint = await Service.discover();
assert.ok(endpoint, "Start an OpenCode service first");
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
const scratch = path.join(os.tmpdir(), "opencode");
await fs.mkdir(scratch, { recursive: true });
const directory = await fs.realpath(await fs.mkdtemp(path.join(scratch, "loadouts-session-e2e-")));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prompts = process.argv.includes("--prompts");
const sessions = [];
const write = async (name, text) => { const file = path.join(directory, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
try {
  await write(".loadouts/loadouts.yaml", "version: '1'\ntools: [opencode]\n");
  await write("AGENTS.md", "Reply exactly ok to probe prompts. Do not use tools.\n");
  for (const name of ["alpha", "beta"]) {
    await write(`.loadouts/loadouts/${name}.yaml`, `name: ${name}\ninclude: [instructions/AGENTS.${name}.md, skills/${name}${name === "beta" ? ", skills/virtual-proof" : ""}]\n`);
    await write(`.loadouts/instructions/AGENTS.${name}.md`, `LOADOUTS_E2E_${name.toUpperCase()}: Reply ok.\n`);
    const skill = `---\nname: ${name}\ndescription: Loadouts E2E ${name} control\n---\nReply ok.\n`;
    await write(`.loadouts/skills/${name}/SKILL.md`, skill);
    await write(`.opencode/skills/${name}/SKILL.md`, skill);
  }
  await write(".loadouts/skills/virtual-proof/SKILL.md", "---\nname: virtual-proof\ndescription: A skill registered from the loadout only.\n---\nLOADOUTS_VIRTUAL_PROOF\n");
  await fs.cp(path.join(repo, "bundled/opencode/plugins/loadouts"), path.join(directory, ".opencode/plugins/loadouts"), { recursive: true });
  await write(".opencode/plugins/z-probe/index.ts", `import { appendFileSync } from 'node:fs';\nexport default { id: 'loadouts.e2e.probe', async setup(ctx) { await ctx.session.hook('context', event => { const text = event.system.map(p => p.text ?? '').join('\\n'); appendFileSync(${JSON.stringify(path.join(directory, "probe.jsonl"))}, JSON.stringify({ sessionID: event.sessionID, alpha: text.includes('<id>alpha</id>'), beta: text.includes('<id>beta</id>'), virtual: text.includes('<id>virtual-proof</id>'), changed: JSON.stringify(event.messages).includes('LOADOUTS_E2E_CHANGED'), supersedes: JSON.stringify(event.messages).includes('supersedes') }) + '\\n'); }); } };\n`);
  const modelText = process.env.OPENCODE_E2E_MODEL;
  const model = modelText ? { providerID: modelText.slice(0, modelText.indexOf("/")), id: modelText.slice(modelText.indexOf("/") + 1) } : undefined;
  for (const name of ["A", "B"]) sessions.push(await client.session.create({ location: { directory }, title: `Loadouts E2E ${name}`, model }));
  const [a, b] = sessions;
  const activator = new SessionActivator(client);
  await client.session.instructions.entry.put({ sessionID: a.id, key: "foreign", value: "Keep this entry." });
  await client.session.update({ sessionID: a.id, permissions: [{ action: "shell", resource: "git push *", effect: "ask" }] });
  await activator.equip(a.id, ["alpha"], { scope: "project" });
  await activator.equip(b.id, ["beta"], { scope: "project" });
  assert.deepEqual((await activator.status(a.id)).names, ["alpha"]);
  assert.deepEqual((await activator.status(b.id)).names, ["beta"]);
  assert.equal((await client.session.instructions.entry.list({ sessionID: b.id })).some(e => e.key === entryKey("alpha")), false);
  assert.ok((await client.session.get({ sessionID: a.id })).permissions.some(r => r.action === "skill" && r.resource === "beta" && r.effect === "deny"));
  const plugins = await client.plugin.list({ location: { directory } });
  const plugin = plugins.data.find(p => p.id === "loadouts");
  assert.ok(plugin, "Packaged server plugin must load");
  assert.equal(plugin.state.status, "active");
  assert.ok((await client.skill.list({ location: { directory } })).data.some(skill => skill.id === "virtual-proof"));
  const rpc = await client.rpc.call({ rpcID: "loadouts", method: "status", location: { directory }, input: { sessionID: b.id } });
  assert.deepEqual(rpc.output.names, ["beta"]);
  console.log("✓ Two isolated sessions; packaged server plugin discovered");
  if (prompts) {
    for (const sessionID of [a.id, b.id]) {
      await client.session.prompt({ sessionID, text: "Reply exactly ok. Do not use tools." });
      await client.session.wait({ sessionID }, { signal: AbortSignal.timeout(90000) });
    }
    await write(".loadouts/instructions/AGENTS.alpha.md", "LOADOUTS_E2E_CHANGED: Reply ok.\n");
    await activator.equip(a.id, ["alpha"], { scope: "project" });
    await client.session.prompt({ sessionID: a.id, text: "Reply exactly ok. Do not use tools." });
    await client.session.wait({ sessionID: a.id }, { signal: AbortSignal.timeout(90000) });
    const rows = (await fs.readFile(path.join(directory, "probe.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(rows.some(row => row.sessionID === a.id && row.alpha && !row.beta && !row.virtual));
    assert.ok(rows.some(row => row.sessionID === b.id && !row.alpha && row.beta && row.virtual));
    assert.ok(rows.some(row => row.sessionID === a.id && row.changed && row.supersedes));
    console.log("✓ Per-session skill advertisements and native superseding instruction notice");
  }
  const reconnected = new SessionActivator(OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) }));
  assert.deepEqual((await reconnected.status(a.id)).names, ["alpha"]);
  await reconnected.unequip(a.id);
  assert.deepEqual(await client.session.instructions.entry.list({ sessionID: a.id }), [{ key: "foreign", value: "Keep this entry." }]);
  assert.deepEqual((await client.session.get({ sessionID: a.id })).permissions, [{ action: "shell", resource: "git push *", effect: "ask" }]);
  assert.deepEqual((await reconnected.status(b.id)).names, ["beta"]);
  console.log("✓ Reconnection, clean unequip, prior permissions restored, control session untouched");
  const messages = (await client.session.context({ sessionID: a.id })).length;
  await client.session.command({ sessionID: a.id, name: "loadouts", text: "equip alpha -p" });
  assert.deepEqual((await reconnected.status(a.id)).names, ["alpha"]);
  assert.equal((await client.session.context({ sessionID: a.id })).length, messages);
  console.log("✓ Headless equip is silent; typed RPC status and off-disk catalog available");
  await write(".loadouts/loadouts.yaml", "version: '1'\ntools: [opencode]\nopencode:\n  defaultSession: [alpha]\n");
  const existing = new Set(sessions.map(session => session.id));
  const defaultEquipped = (async () => {
    for await (const event of client.event.subscribe({ signal: AbortSignal.timeout(15000) })) {
      if (event.type === "session.permissions" && event.location?.directory === directory && !existing.has(event.data.sessionID)) return event.data.sessionID;
    }
    throw new Error("No auto-equip event received");
  })();
  const automatic = await client.session.create({ location: { directory }, title: "Loadouts auto-equip proof" });
  sessions.push(automatic);
  assert.equal(await defaultEquipped, automatic.id);
  assert.deepEqual((await reconnected.status(automatic.id)).names, ["alpha"]);
  console.log("✓ New root session auto-equips the project default");
} finally {
  for (const session of sessions) {
    await client.session.interrupt({ sessionID: session.id }).catch(() => {});
    await client.session.remove({ sessionID: session.id });
  }
  console.log(`Probe artifacts: ${directory}`);
}
