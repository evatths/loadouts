/** Isolated service restart proof. Never stops the user's registered service. */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { SessionActivator } from "../dist/integrations/opencode/session.js";
import { TESTED_OPENCODE_VERSION } from "../dist/integrations/opencode/client.js";
import { registerBuiltins } from "../dist/builtins/index.js";
import { registry } from "../dist/core/registry.js";
import { createPluginAPI } from "../dist/core/plugin.js";

registerBuiltins(createPluginAPI(registry));
const scratch = path.join(os.tmpdir(), "opencode");
await fs.mkdir(scratch, { recursive: true });
const directory = await fs.realpath(await fs.mkdtemp(path.join(scratch, "loadouts-restart-")));
const env = { ...process.env, XDG_CONFIG_HOME: path.join(directory, "config"), XDG_STATE_HOME: path.join(directory, "state"), XDG_DATA_HOME: path.join(directory, "data"), XDG_CACHE_HOME: path.join(directory, "cache") };
const file = path.join(env.XDG_STATE_HOME, "opencode/service.json");
const project = path.join(directory, "project");
const write = async (name, text) => { const target = path.join(project, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
for (const name of ["alpha", "beta"]) {
  await write(`.loadouts/loadouts/${name}.yaml`, `name: ${name}\ntools: [opencode]\ninclude: [instructions/AGENTS.${name}.md]\n`);
  await write(`.loadouts/instructions/AGENTS.${name}.md`, `Restart proof ${name}.\n`);
  await write(`.opencode/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Restart proof\n---\nReply ok.\n`);
}
const connect = async () => {
  const endpoint = await Service.ensure({ file, env, version: TESTED_OPENCODE_VERSION, command: ["opencode", "serve", "--service", "--hostname", "127.0.0.1", "--port", "0"] });
  return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
};
try {
  let client = await connect();
  const a = await client.session.create({ location: { directory: project }, title: "Restart proof A" });
  const b = await client.session.create({ location: { directory: project }, title: "Restart proof B" });
  let equipment = new SessionActivator(client);
  await equipment.equip(a.id, ["alpha"], { scope: "project" });
  await equipment.equip(b.id, ["beta"], { scope: "project" });
  const before = await client.session.get({ sessionID: a.id });
  await Service.stop({ file, pty: "clear" });
  client = await connect();
  equipment = new SessionActivator(client);
  assert.deepEqual((await equipment.status(a.id)).names, ["alpha"]);
  assert.deepEqual((await equipment.status(b.id)).names, ["beta"]);
  assert.deepEqual((await client.session.get({ sessionID: a.id })).permissions, before.permissions);
  await equipment.unequip(a.id);
  assert.equal(await equipment.status(a.id), undefined);
  assert.deepEqual((await equipment.status(b.id)).names, ["beta"]);
  console.log("✓ Entries and gates survived an isolated service restart; unequip left the control session intact");
} finally {
  await Service.stop({ file, pty: "clear" });
  console.log(`Isolated service artifacts: ${directory}`);
}
