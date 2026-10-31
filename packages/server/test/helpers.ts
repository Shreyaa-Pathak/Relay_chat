import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { sql } from "drizzle-orm";
import type { ServerEvent } from "@relay/shared";
import { loadEnv, type Env } from "../src/env.js";
import { createDb, createPool } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { seedDefaultChannels } from "../src/db/seed.js";
import { startServer, type RunningServer } from "../src/server.js";
import { RedisBus } from "../src/bus/redis.js";
import { RedisPresence } from "../src/presence/redis.js";
import { createLogger } from "../src/log.js";
import type { Bus } from "../src/bus/types.js";

export const ORIGIN = "http://relay.test";
export const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://relay:relay@localhost:5432/relay_test";
export const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";

export function testEnv(over: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    DATABASE_URL,
    REDIS_URL,
    AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
    APP_URL: ORIGIN,
    LOG_LEVEL: (process.env.TEST_LOG_LEVEL as string) ?? "error",
    REGISTER_LIMIT_PER_HOUR: "100000",
    ...over,
  });
}

export async function resetDb() {
  const pool = createPool(DATABASE_URL, 1);
  const db = createDb(pool);
  await runMigrations(db);
  await db.execute(sql`truncate messages, memberships, sessions, users, rooms restart identity cascade`);
  await seedDefaultChannels(db);
  await pool.end();
}

export interface Cluster {
  servers: RunningServer[];
  prefix: string;
  close(): Promise<void>;
}

/** N server instances sharing Postgres and Redis, each with its own Redis connections. */
export async function startCluster(n: number, opts: { env?: Record<string, string>; wrapBus?: (i: number, bus: Bus) => Bus } = {}): Promise<Cluster> {
  const prefix = `test:${randomUUID().slice(0, 8)}:`;
  const servers: RunningServer[] = [];
  for (let i = 0; i < n; i++) {
    const env = testEnv(opts.env);
    const log = createLogger(env.LOG_LEVEL, { instance: i });
    const redisBus = new RedisBus(REDIS_URL, log, { prefix, lingerMs: 200 });
    const presence = new RedisPresence(redisBus.commands, `${prefix}presence`);
    const bus = opts.wrapBus ? opts.wrapBus(i, redisBus) : redisBus;
    servers.push(await startServer(env, { bus, presence, log }));
  }
  return {
    servers,
    prefix,
    async close() {
      await Promise.all(servers.map((s) => s.close()));
    },
  };
}

export class TestUser {
  cookies = new Map<string, string>();
  id = "";
  displayName = "";
  constructor(public baseUrl: string) {}

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i);
      const v = pair!.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.baseUrl + "/api/v1" + path, {
      method,
      headers: {
        origin: ORIGIN,
        "x-relay-csrf": "1",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        cookie: this.cookieHeader(),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    this.absorb(res);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, res };
  }

  static async register(baseUrl: string, name = "user"): Promise<TestUser> {
    const u = new TestUser(baseUrl);
    const email = `${name}-${randomUUID().slice(0, 8)}@example.com`;
    const r = await u.req("POST", "/auth/register", { email, password: "correct horse battery", displayName: name });
    if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
    u.id = r.body.user.id;
    u.displayName = name;
    (u as TestUser & { email: string }).email = email;
    return u;
  }

  async rooms(): Promise<{ id: string; slug: string; isMember: boolean; lastSeq: number }[]> {
    return (await this.req("GET", "/rooms")).body.rooms;
  }

  async connect(wsUrl: string, opts: { origin?: string; cookie?: string } = {}): Promise<TestSocket> {
    return TestSocket.open(wsUrl, { origin: opts.origin ?? ORIGIN, cookie: opts.cookie ?? this.cookieHeader() });
  }
}

export class TestSocket {
  events: ServerEvent[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: { pred: (e: ServerEvent) => boolean; resolve: (e: ServerEvent) => void }[] = [];
  private closeWaiters: ((c: { code: number }) => void)[] = [];

  constructor(public ws: WebSocket) {
    ws.on("message", (d) => {
      const ev = JSON.parse(d.toString()) as ServerEvent;
      this.events.push(ev);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(ev)) {
          w.resolve(ev);
          return false;
        }
        return true;
      });
    });
    ws.on("close", (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      for (const w of this.closeWaiters) w({ code });
    });
  }

  static open(url: string, headers: { origin: string; cookie: string }): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { origin: headers.origin, cookie: headers.cookie } });
      const s = new TestSocket(ws);
      ws.once("open", () => resolve(s));
      ws.once("unexpected-response", (_req, res) => reject(Object.assign(new Error(`upgrade rejected ${res.statusCode}`), { status: res.statusCode })));
      ws.once("error", reject);
    });
  }

  send(ev: unknown) {
    this.ws.send(JSON.stringify(ev));
  }

  waitFor<T extends ServerEvent["type"]>(type: T, pred: (e: Extract<ServerEvent, { type: T }>) => boolean = () => true, timeoutMs = 5000): Promise<Extract<ServerEvent, { type: T }>> {
    const match = (e: ServerEvent) => e.type === type && pred(e as Extract<ServerEvent, { type: T }>);
    const found = this.events.find(match);
    if (found) return Promise.resolve(found as Extract<ServerEvent, { type: T }>);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({ pred: match, resolve: (e) => (clearTimeout(t), resolve(e as Extract<ServerEvent, { type: T }>)) });
    });
  }

  /** Resolves true if an event matching pred arrives within ms, false otherwise. */
  async receives<T extends ServerEvent["type"]>(type: T, pred: (e: Extract<ServerEvent, { type: T }>) => boolean, ms: number) {
    return this.waitFor(type, pred, ms).then(() => true, () => false);
  }

  waitClose(timeoutMs = 5000): Promise<{ code: number }> {
    if (this.closed) return Promise.resolve(this.closed);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs);
      this.closeWaiters.push((c) => (clearTimeout(t), resolve(c)));
    });
  }

  async ready() {
    return this.waitFor("hello");
  }

  async subscribe(roomIds: string[]) {
    const before = this.events.length;
    this.send({ type: "room.subscribe", roomIds });
    return this.waitFor("room.subscribed", (e) => this.events.indexOf(e) >= before);
  }

  sendMessage(roomId: string, body: string, opts: { clientId?: string; parentId?: string } = {}) {
    const clientId = opts.clientId ?? randomUUID();
    this.send({ type: "message.send", roomId, clientId, body, parentId: opts.parentId });
    return clientId;
  }

  async sendAndAck(roomId: string, body: string, opts: { clientId?: string; parentId?: string } = {}) {
    const from = this.events.length;
    const fresh = (e: ServerEvent) => this.events.indexOf(e) >= from;
    const clientId = this.sendMessage(roomId, body, opts);
    const result = await Promise.race([
      this.waitFor("message.ack", (e) => e.clientId === clientId && fresh(e)),
      this.waitFor("message.error", (e) => e.clientId === clientId && fresh(e)),
    ]);
    return result;
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
