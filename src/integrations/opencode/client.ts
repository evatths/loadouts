import * as path from "node:path";
import { realpathSync } from "node:fs";
import { OpenCode, type SessionInfo } from "@opencode/client";
import { Service } from "@opencode/client/service";

export const TESTED_OPENCODE_VERSION = "2.0.32";
export interface Connection { client: ReturnType<typeof OpenCode.make>; version: string; warning?: string }

export async function discoverClient(): Promise<Connection | undefined> {
  const endpoint = await Service.discover();
  if (!endpoint) return undefined;
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const { version } = await client.server.info();
  return { client, version, warning: version === TESTED_OPENCODE_VERSION
    ? undefined : `OpenCode ${version} is running; Loadouts is tested against ${TESTED_OPENCODE_VERSION}.` };
}

export async function requireClient(): Promise<Connection> {
  const connection = await discoverClient();
  if (!connection) throw new Error("No running OpenCode service found. Start OpenCode, then retry.");
  return connection;
}

export async function sessionsAt(client: ReturnType<typeof OpenCode.make>, cwd: string) {
  const sessions: SessionInfo[] = [];
  let cursor: string | undefined;
  do {
    const result = await client.session.list({ directory: canonical(cwd), order: "desc", limit: 100, cursor });
    sessions.push(...result.data);
    cursor = result.cursor.next ?? undefined;
  } while (cursor);
  return sessions.filter((session) => !session.time.archived && canonical(session.location.directory) === canonical(cwd));
}

export async function selectSession(client: ReturnType<typeof OpenCode.make>, cwd: string, sessionID?: string) {
  if (sessionID) return client.session.get({ sessionID });
  const sessions = await sessionsAt(client, cwd);
  const session = sessions.filter((item) => !item.parentID).sort((a, b) => b.time.updated - a.time.updated)[0];
  if (!session) throw new Error(`No OpenCode session at ${cwd}. Specify --session <id>.`);
  return session;
}

function canonical(directory: string): string {
  try { return realpathSync(directory); } catch { return path.resolve(directory); }
}
