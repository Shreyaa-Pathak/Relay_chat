import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CloseCodes } from "@relay/shared";
import { createDb, createPool } from "../src/db/client.js";
import { DATABASE_URL, ORIGIN, REDIS_URL, resetDb, sleep, startCluster, TestUser, type Cluster } from "./helpers.js";
import type { Bus } from "../src/bus/types.js";

let c: Cluster;
let a: TestUser; // talks to instance 0
let b: TestUser; // talks to instance 1
let general: string;
let design: string;
const pool = createPool(DATABASE_URL, 2);
const db = createDb(pool);

beforeAll(async () => {
  await resetDb();
  c = await startCluster(2);
  a = await TestUser.register(c.servers[0]!.url, "ada");
  b = await TestUser.register(c.servers[1]!.url, "bo");
  const rooms = await a.rooms();
  general = rooms.find((r) => r.slug === "general")!.id;
  design = rooms.find((r) => r.slug === "design")!.id;
});
afterAll(async () => {
  await c.close();
  await pool.end();
});

const ws0 = () => c.servers[0]!.wsUrl;
const ws1 = () => c.servers[1]!.wsUrl;

describe("connection handshake", () => {
  it("closes with 4401 when there is no valid access token", async () => {
    const anon = new TestUser(c.servers[0]!.url);
    const s = await anon.connect(ws0(), { cookie: "" });
    expect((await s.waitClose()).code).toBe(CloseCodes.Unauthorized);
  });

  it("rejects upgrades from untrusted origins", async () => {
    await expect(a.connect(ws0(), { origin: "https://evil.example" })).rejects.toMatchObject({ status: 403 });
  });

  it("sends hello with the server's max connection lifetime", async () => {
    const s = await a.connect(ws0());
    const hello = await s.ready();
    expect(hello.user.id).toBe(a.id);
    expect(hello.maxConnectionMs).toBeGreaterThan(0);
    s.close();
  });
});

describe("message flow across instances", () => {
  it("persists, publishes through Redis to the other instance, then acks with the authoritative id and seq", async () => {
    const sa = await a.connect(ws0());
    const sb = await b.connect(ws1());
    await Promise.all([sa.ready(), sb.ready()]);
    const subA = await sa.subscribe([general]);
    await sb.subscribe([general]);
    const before = subA.rooms[0]!.lastSeq;

    const clientId = sa.sendMessage(general, "hello from instance 0");
    const ack = await sa.waitFor("message.ack", (e) => e.clientId === clientId);
    expect(ack.duplicate).toBe(false);
    expect(ack.message.seq).toBe(before + 1);
    const got = await sb.waitFor("message.new", (e) => e.message.clientId === clientId);
    expect(got.message).toMatchObject({ id: ack.message.id, seq: ack.message.seq, body: "hello from instance 0" });
    expect(got.message.author.displayName).toBe("ada");

    const row = await db.execute(sql`select body, seq from messages where id = ${ack.message.id}`);
    expect(row.rows[0]).toMatchObject({ body: "hello from instance 0", seq: String(before + 1) });
    sa.close();
    sb.close();
  });

  it("treats a retry with the same clientId as the same message (idempotent)", async () => {
    const sa = await a.connect(ws0());
    await sa.ready();
    await sa.subscribe([general]);
    const clientId = randomUUID();
    const first = await sa.sendAndAck(general, "only once", { clientId });
    const second = await sa.sendAndAck(general, "only once", { clientId });
    expect(first.type).toBe("message.ack");
    expect(second.type).toBe("message.ack");
    if (first.type !== "message.ack" || second.type !== "message.ack") throw new Error("unreachable");
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(second.message.seq).toBe(first.message.seq);
    const count = await db.execute(sql`select count(*)::int as n from messages where client_id = ${clientId}`);
    expect(count.rows[0]).toEqual({ n: 1 });
    sa.close();
  });

  it("allocates unique, gap-free sequence numbers under concurrent sends from two instances", async () => {
    const room = design;
    const { rows } = await db.execute(sql`select last_seq from rooms where id = ${room}`);
    const start = Number((rows[0] as { last_seq: string }).last_seq);
    const sockets = await Promise.all([a.connect(ws0()), a.connect(ws1()), b.connect(ws0()), b.connect(ws1())]);
    await Promise.all(sockets.map((s) => s.ready()));
    await Promise.all(sockets.map((s) => s.subscribe([room])));
    const N = 15;
    const acks = await Promise.all(sockets.flatMap((s, i) => Array.from({ length: N }, (_, j) => s.sendAndAck(room, `c${i}-${j}`))));
    const seqs = acks.map((x) => (x.type === "message.ack" ? x.message.seq : -1)).sort((x, y) => x - y);
    expect(seqs).toEqual(Array.from({ length: N * 4 }, (_, k) => start + k + 1));
    const dbSeqs = await db.execute(sql`select seq from messages where room_id = ${room} and seq > ${start} order by seq`);
    expect(dbSeqs.rows.map((r) => Number((r as { seq: string }).seq))).toEqual(seqs);
    sockets.forEach((s) => s.close());
  }, 30_000);

  it("rejects invalid payloads with a non-retryable error", async () => {
    const sa = await a.connect(ws0());
    await sa.ready();
    sa.send({ type: "message.send", roomId: general, clientId: "badbody1", body: "   " });
    const err = await sa.waitFor("message.error", (e) => e.clientId === "badbody1");
    expect(err).toMatchObject({ code: "validation", retryable: false });
    sa.send("not json" as unknown as object);
    sa.ws.send("{oops");
    await sa.waitFor("error", (e) => e.code === "bad_json");
    sa.close();
  });
});

describe("authorization", () => {
  let secret: string;
  beforeAll(async () => {
    const r = await db.execute(sql`insert into rooms (community_id, slug, name, is_private) values ('00000000-0000-4000-8000-000000000001', 'secret', 'secret', true) returning id`);
    secret = (r.rows[0] as { id: string }).id;
    await db.execute(sql`insert into memberships (room_id, user_id) values (${secret}, ${a.id})`);
  });

  it("hides private rooms from non-members and denies subscribe, send and history", async () => {
    expect((await b.rooms()).some((r) => r.id === secret)).toBe(false);
    expect((await a.rooms()).some((r) => r.id === secret)).toBe(true);
    const sb = await b.connect(ws1());
    await sb.ready();
    const sub = await sb.subscribe([secret, general]);
    expect(sub.denied).toEqual([secret]);
    expect(sub.rooms.map((r) => r.roomId)).toEqual([general]);
    const res = await sb.sendAndAck(secret, "let me in");
    expect(res).toMatchObject({ type: "message.error", code: "forbidden", retryable: false });
    expect((await b.req("GET", `/rooms/${secret}/messages`)).status).toBe(404);
    expect((await b.req("POST", `/rooms/${secret}/join`)).status).toBe(404);
    sb.close();
  });

  it("revokes live access when a member leaves a channel", async () => {
    const sb = await b.connect(ws1());
    const sb2 = await b.connect(ws0()); // second tab on the other instance
    await Promise.all([sb.ready(), sb2.ready()]);
    await sb.subscribe([general]);
    await sb2.subscribe([general]);
    expect((await b.req("POST", `/rooms/${general}/leave`)).status).toBe(200);
    await sb2.waitFor("membership.revoked", (e) => e.roomId === general && e.userId === b.id);
    expect((await sb.sendAndAck(general, "still here?"))).toMatchObject({ type: "message.error", code: "forbidden" });
    expect((await b.req("GET", `/rooms/${general}/messages`)).status).toBe(403);
    // After leaving, other people's messages no longer reach this user.
    const sa = await a.connect(ws0());
    await sa.ready();
    await sa.subscribe([general]);
    const cid = sa.sendMessage(general, "after b left");
    await sa.waitFor("message.ack", (e) => e.clientId === cid);
    expect(await sb2.receives("message.new", (e) => e.message.clientId === cid, 500)).toBe(false);
    // Rejoin restores access.
    expect((await b.req("POST", `/rooms/${general}/join`)).status).toBe(200);
    expect((await b.req("GET", `/rooms/${general}/messages`)).status).toBe(200);
    [sa, sb, sb2].forEach((s) => s.close());
  });
});

describe("history, threads and gap recovery", () => {
  let room: string;
  beforeAll(async () => {
    room = (await a.rooms()).find((r) => r.slug === "random")!.id;
  });

  it("keeps replies out of the channel timeline, counts them, and pages both", async () => {
    const sa = await a.connect(ws0());
    const sb = await b.connect(ws1());
    await Promise.all([sa.ready(), sb.ready()]);
    await sa.subscribe([room]);
    await sb.subscribe([room]);
    const tops = [];
    for (let i = 0; i < 7; i++) tops.push(await sa.sendAndAck(room, `top ${i}`));
    const parent = tops[2]!;
    if (parent.type !== "message.ack") throw new Error("send failed");
    for (let i = 0; i < 3; i++) {
      const r = await sb.sendAndAck(room, `reply ${i}`, { parentId: parent.message.id });
      expect(r.type).toBe("message.ack");
      if (r.type === "message.ack") expect(r.message.parentReplyCount).toBe(i + 1);
    }
    // Live reply events reach the other instance with the parent's new count.
    const live = await sa.waitFor("message.new", (e) => e.message.body === "reply 2");
    expect(live.message.parentReplyCount).toBe(3);

    const p1 = await a.req("GET", `/rooms/${room}/messages?limit=4`);
    expect(p1.body.messages.map((m: { body: string }) => m.body)).toEqual(["top 3", "top 4", "top 5", "top 6"]);
    expect(p1.body.hasMore).toBe(true);
    const p2 = await a.req("GET", `/rooms/${room}/messages?limit=4&beforeSeq=${p1.body.messages[0].seq}`);
    expect(p2.body.messages.map((m: { body: string }) => m.body)).toEqual(["top 0", "top 1", "top 2"]);
    expect(p2.body.hasMore).toBe(false);
    expect(p2.body.messages[2].replyCount).toBe(3);

    const t1 = await a.req("GET", `/messages/${parent.message.id}/replies?limit=2`);
    expect(t1.body.messages.map((m: { body: string }) => m.body)).toEqual(["reply 0", "reply 1"]);
    expect(t1.body.hasMore).toBe(true);
    const t2 = await a.req("GET", `/messages/${parent.message.id}/replies?limit=2&afterSeq=${t1.body.messages[1].seq}`);
    expect(t2.body.messages.map((m: { body: string }) => m.body)).toEqual(["reply 2"]);

    // Replies to replies and cross-room parents are refused.
    const reply = t1.body.messages[0];
    expect(await sb.sendAndAck(room, "nested", { parentId: reply.id })).toMatchObject({ type: "message.error", code: "validation" });
    expect(await sb.sendAndAck(general, "wrong room", { parentId: parent.message.id })).toMatchObject({ type: "message.error", code: "not_found" });
    sa.close();
    sb.close();
  });

  it("returns every message after a seq (top-level and replies) for gap fill", async () => {
    const page = await a.req("GET", `/rooms/${room}/messages?afterSeq=5`);
    const seqs = page.body.messages.map((m: { seq: number }) => m.seq);
    expect(seqs[0]).toBe(6);
    expect(seqs).toEqual([...seqs].sort((x: number, y: number) => x - y));
    expect(page.body.messages.some((m: { parentId: string | null }) => m.parentId)).toBe(true);
    expect(page.body.roomLastSeq).toBe(seqs.at(-1));
  });

  it("rejects ambiguous history queries", async () => {
    expect((await a.req("GET", `/rooms/${room}/messages?afterSeq=1&beforeSeq=5`)).status).toBe(400);
    expect((await a.req("GET", `/rooms/not-a-uuid/messages`)).status).toBe(400);
  });
});

describe("typing", () => {
  it("broadcasts throttled typing to others, never to the sender, and never persists it", async () => {
    const sa = await a.connect(ws0());
    const sb = await b.connect(ws1());
    await Promise.all([sa.ready(), sb.ready()]);
    await sa.subscribe([general]);
    await sb.subscribe([general]);
    const n0 = (await db.execute(sql`select count(*)::int as n from messages`)).rows[0];
    for (let i = 0; i < 5; i++) sa.send({ type: "typing", roomId: general });
    await sb.waitFor("typing", (e) => e.user.id === a.id);
    await sleep(400);
    expect(sb.events.filter((e) => e.type === "typing").length).toBe(1);
    expect(sa.events.some((e) => e.type === "typing")).toBe(false);
    expect((await db.execute(sql`select count(*)::int as n from messages`)).rows[0]).toEqual(n0);
    sa.close();
    sb.close();
  });

  it("announces typing again right after a message is sent", async () => {
    const sa = await a.connect(ws0());
    const sb = await b.connect(ws1());
    await Promise.all([sa.ready(), sb.ready()]);
    await sa.subscribe([general]);
    await sb.subscribe([general]);
    sa.send({ type: "typing", roomId: general });
    await sb.waitFor("typing", (e) => e.user.id === a.id);
    await sa.sendAndAck(general, "done typing");
    const before = sb.events.length;
    sa.send({ type: "typing", roomId: general });
    await sb.waitFor("typing", (e) => e.user.id === a.id && sb.events.indexOf(e) >= before, 2000);
    sa.close();
    sb.close();
  });

  it("refuses typing in rooms the socket hasn't subscribed to", async () => {
    const sa = await a.connect(ws0());
    await sa.ready();
    sa.send({ type: "typing", roomId: design });
    await sa.waitFor("error", (e) => e.code === "forbidden");
    sa.close();
  });
});

describe("presence", () => {
  it("tracks each connection, so one closed tab doesn't hide a user with another tab open", async () => {
    const watcher = await b.connect(ws1());
    await watcher.ready();
    const tab1 = await a.connect(ws0());
    const h1 = await tab1.ready();
    const tab2 = await a.connect(ws1());
    const h2 = await tab2.ready();
    await watcher.waitFor("presence.update", (e) => e.entry.connId === h2.connId && e.state === "online");

    tab1.close();
    await watcher.waitFor("presence.update", (e) => e.entry.connId === h1.connId && e.state === "offline");
    const snap1Before = watcher.events.length;
    watcher.send({ type: "presence.request" });
    const snap = await watcher.waitFor("presence.snapshot", (e) => watcher.events.indexOf(e) >= snap1Before);
    expect(snap.entries.filter((e) => e.user.id === a.id).map((e) => e.connId)).toEqual([h2.connId]);

    tab2.close();
    await watcher.waitFor("presence.update", (e) => e.entry.connId === h2.connId && e.state === "offline");
    const before = watcher.events.length;
    watcher.send({ type: "presence.request" });
    const snap2 = await watcher.waitFor("presence.snapshot", (e) => watcher.events.indexOf(e) >= before);
    expect(snap2.entries.some((e) => e.user.id === a.id)).toBe(false);
    watcher.close();
  });

  it("skips the offline broadcast on a planned reconnect", async () => {
    const watcher = await b.connect(ws1());
    await watcher.ready();
    const s = await a.connect(ws0());
    const h = await s.ready();
    s.send({ type: "bye", reason: "reconnect" });
    await sleep(50);
    s.close();
    expect(await watcher.receives("presence.update", (e) => e.entry.connId === h.connId && e.state === "offline", 500)).toBe(false);
    watcher.close();
  });
});

describe("failure recovery", () => {
  it("still commits and acks when Redis publish fails; the other instance recovers the message by seq", async () => {
    let failing = false;
    const flaky = (_i: number, bus: Bus): Bus => ({
      subscribe: (t, h) => bus.subscribe(t, h),
      publish: (t, e) => (failing && e.type === "message.new" ? Promise.reject(new Error("redis down")) : bus.publish(t, e)),
      onRecovered: (cb) => bus.onRecovered(cb),
      activeTopics: () => bus.activeTopics(),
      ping: () => bus.ping(),
      close: () => bus.close(),
    });
    const fc = await startCluster(2, { wrapBus: flaky });
    try {
      const sa = await a.connect(fc.servers[0]!.wsUrl);
      const sb = await b.connect(fc.servers[1]!.wsUrl);
      await Promise.all([sa.ready(), sb.ready()]);
      const sub = await sb.subscribe([general]);
      await sa.subscribe([general]);
      const lastSeen = sub.rooms[0]!.lastSeq;

      failing = true;
      const lost = await sa.sendAndAck(general, "published while redis was down");
      expect(lost.type).toBe("message.ack");
      if (lost.type !== "message.ack") return;
      expect(await sb.receives("message.new", (e) => e.message.id === lost.message.id, 500)).toBe(false);
      expect(fc.servers.reduce((n, s) => n + s.relay.metrics.publishFailures, 0)).toBe(1);

      failing = false;
      const next = await sa.sendAndAck(general, "redis is back");
      const live = await sb.waitFor("message.new", (e) => e.message.clientId === (next.type === "message.ack" ? next.message.clientId : ""));
      // The client sees a seq jump (lastSeen -> lastSeen + 2) and fills the gap over REST:
      expect(live.message.seq).toBe(lastSeen + 2);
      const fill = await b.req("GET", `/rooms/${general}/messages?afterSeq=${lastSeen}`);
      expect(fill.body.messages.map((m: { id: string }) => m.id)).toContain(lost.message.id);
      sa.close();
      sb.close();
    } finally {
      await fc.close();
    }
  });

  it("tells clients to resync after the Redis subscriber connection is dropped and restored", async () => {
    const fc = await startCluster(1);
    try {
      const s = await a.connect(fc.servers[0]!.wsUrl);
      await s.ready();
      await s.subscribe([general]);
      // Kill this instance's subscriber connection (ioredis reconnects and resubscribes).
      const port = new URL(REDIS_URL).port || "6379";
      execSync(`redis-cli -p ${port} CLIENT KILL TYPE pubsub`, { stdio: "ignore" });
      await s.waitFor("resync", (e) => e.reason === "bus_recovered", 10_000);
      // Delivery works again afterwards.
      const cid = s.sendMessage(general, "after recovery");
      await s.waitFor("message.new", (e) => e.message.clientId === cid, 5000);
      s.close();
    } finally {
      await fc.close();
    }
  }, 20_000);

  it("closes connections at the configured max lifetime with a reconnect code", async () => {
    const fc = await startCluster(1, { env: { WS_MAX_CONNECTION_MS: "10000" } });
    try {
      const s = await a.connect(fc.servers[0]!.wsUrl);
      const hello = await s.ready();
      expect(hello.maxConnectionMs).toBe(10_000);
      expect((await s.waitClose(15_000)).code).toBe(CloseCodes.MaxDuration);
    } finally {
      await fc.close();
    }
  }, 20_000);

  it("closes sockets with 1012 on graceful shutdown", async () => {
    const fc = await startCluster(1);
    const s = await a.connect(fc.servers[0]!.wsUrl);
    await s.ready();
    const closing = s.waitClose();
    await fc.close();
    expect((await closing).code).toBe(CloseCodes.ServiceRestart);
  });
});

describe("rate limits", () => {
  it("limits message bursts per connection with a retryable error", async () => {
    const s = await a.connect(ws0());
    await s.ready();
    await s.subscribe([design]);
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => s.sendAndAck(design, `burst ${i}`)));
    const limited = results.filter((r) => r.type === "message.error" && r.code === "rate_limited");
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.every((r) => r.type === "message.error" && r.retryable)).toBe(true);
    s.close();
  });
});

void ORIGIN;
