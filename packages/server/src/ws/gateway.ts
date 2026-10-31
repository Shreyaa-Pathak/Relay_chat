import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  ClientEvent,
  CloseCodes,
  LIMITS,
  PROTOCOL_VERSION,
  topics,
  type BusEvent,
  type MessageErrorEvent,
  type PresenceEntry,
  type ServerEvent,
  type UserPublic,
} from "@relay/shared";
import type { Relay } from "../context.js";
import { AppError } from "../errors.js";
import { ACCESS_COOKIE, parseCookies } from "../auth/cookies.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { getMe, getUsersPublic } from "../repo/users.js";
import { memberRoomSeqs } from "../repo/rooms.js";
import { sendMessage } from "../repo/messages.js";
import { publishWithRetry } from "../bus/redis.js";
import { TokenBucket } from "../ratelimit.js";
import { isTrustedOrigin } from "../http/app.js";
import type { Logger } from "../log.js";

interface Conn {
  id: string;
  ws: WebSocket;
  user: UserPublic;
  /** Rooms this socket is subscribed to (membership verified at subscribe time). */
  rooms: Set<string>;
  topics: Set<string>;
  sendBucket: TokenBucket;
  typingLast: Map<string, number>;
  byeReason: string | null;
  serverClosedPlanned: boolean;
  alive: boolean;
  timers: NodeJS.Timeout[];
  log: Logger;
}

interface LocalTopic {
  conns: Set<Conn>;
  unsubscribe: Promise<() => void>;
}

/** Presence records outlive the connection's max lifetime by this much, covering the reconnect gap. */
const PRESENCE_GRACE_MS = 60_000;
const HEARTBEAT_MS = 25_000;
const MAX_BUFFERED_BYTES = 1_000_000;

export class Gateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  private readonly conns = new Set<Conn>();
  private readonly local = new Map<string, LocalTopic>();
  private closing = false;

  constructor(private readonly relay: Relay) {
    relay.bus.onRecovered(() => {
      // Redis dropped and came back: events published meanwhile were lost. Clients gap-fill by seq.
      for (const c of this.conns) this.send(c, { type: "resync", reason: "bus_recovered" });
    });
  }

  get connectionCount() {
    return this.conns.size;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (this.closing) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    // Cross-site WebSocket hijacking protection: browsers always send Origin on WS handshakes.
    if (!isTrustedOrigin(this.relay, req.headers.origin)) {
      this.relay.log.warn("ws upgrade rejected: untrusted origin", { origin: req.headers.origin });
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      void this.onConnection(ws, req);
    });
  }

  private async onConnection(ws: WebSocket, req: IncomingMessage) {
    const { env, db, log, metrics, presence } = this.relay;
    // Buffer anything the client sends before we finish authenticating.
    const early: RawData[] = [];
    const earlyListener = (d: RawData) => early.push(d);
    ws.on("message", earlyListener);

    const userId = await verifyAccessToken(env.AUTH_SECRET, parseCookies(req)[ACCESS_COOKIE]);
    const user = userId ? await getMe(db, userId).catch(() => null) : null;
    if (!user) {
      ws.close(CloseCodes.Unauthorized, "unauthorized");
      return;
    }

    const connId = randomUUID();
    const conn: Conn = {
      id: connId,
      ws,
      user: { id: user.id, displayName: user.displayName, avatarColor: user.avatarColor },
      rooms: new Set(),
      topics: new Set(),
      sendBucket: new TokenBucket(20, 2),
      typingLast: new Map(),
      byeReason: null,
      serverClosedPlanned: false,
      alive: true,
      timers: [],
      log: log.child({ connId, userId: user.id }),
    };
    this.conns.add(conn);
    metrics.connectionsOpen++;
    metrics.connectionsTotal++;

    ws.off("message", earlyListener);
    ws.on("message", (d) => void this.onRaw(conn, d));
    ws.on("pong", () => (conn.alive = true));
    ws.on("close", (code) => void this.onClose(conn, code));
    ws.on("error", (err) => conn.log.warn("socket error", { err: err.message }));

    const maxMs = env.WS_MAX_CONNECTION_MS;
    conn.timers.push(
      setTimeout(() => {
        conn.serverClosedPlanned = true;
        ws.close(CloseCodes.MaxDuration, "max connection duration reached");
      }, maxMs),
      setInterval(() => {
        if (!conn.alive) {
          conn.log.info("terminating unresponsive socket");
          ws.terminate();
          return;
        }
        conn.alive = false;
        ws.ping();
      }, HEARTBEAT_MS),
    );

    this.send(conn, { type: "hello", protocol: PROTOCOL_VERSION, connId, user: conn.user, maxConnectionMs: maxMs, serverTime: Date.now() });
    conn.log.debug("connected");

    // Presence: one record per connection, expiring shortly after this socket's max lifetime.
    const expiresAt = Date.now() + maxMs + PRESENCE_GRACE_MS;
    try {
      await this.subscribeConn(conn, topics.presence);
      await presence.join({ userId: user.id, connId, expiresAt });
      await this.relay.bus.publish(topics.presence, { type: "presence.update", state: "online", entry: { user: conn.user, connId, expiresAt } });
    } catch (err) {
      conn.log.warn("presence join failed", { err: (err as Error).message });
    }
    await this.sendSnapshot(conn);

    for (const d of early) await this.onRaw(conn, d);
  }

  private async onRaw(conn: Conn, data: RawData) {
    let json: unknown;
    try {
      json = JSON.parse(data.toString());
    } catch {
      this.send(conn, { type: "error", code: "bad_json", message: "Messages must be JSON" });
      return;
    }
    const parsed = ClientEvent.safeParse(json);
    if (!parsed.success) {
      const maybe = json as { type?: unknown; clientId?: unknown };
      if (maybe?.type === "message.send" && typeof maybe.clientId === "string") {
        this.send(conn, {
          type: "message.error",
          clientId: maybe.clientId,
          code: "validation",
          message: parsed.error.issues[0]?.message ?? "Invalid message",
          retryable: false,
        });
      } else {
        this.send(conn, { type: "error", code: "bad_event", message: parsed.error.issues[0]?.message ?? "Unknown event" });
      }
      return;
    }
    try {
      await this.onEvent(conn, parsed.data);
    } catch (err) {
      conn.log.error("event handler failed", { type: parsed.data.type, err });
      this.send(conn, { type: "error", code: "server", message: "The server couldn't handle that. Try again." });
    }
  }

  private async onEvent(conn: Conn, ev: ClientEvent) {
    const { db } = this.relay;
    switch (ev.type) {
      case "room.subscribe": {
        const ids = [...new Set(ev.roomIds)];
        const allowed = await memberRoomSeqs(db, conn.user.id, ids);
        for (const id of allowed.keys()) {
          await this.subscribeConn(conn, topics.room(id));
          conn.rooms.add(id);
        }
        // Read last seq AFTER the subscription is live: any message committed later arrives as an
        // event; anything at or below it is fetched by the client over REST. No gap either way.
        const seqs = await memberRoomSeqs(db, conn.user.id, [...allowed.keys()]);
        this.send(conn, {
          type: "room.subscribed",
          rooms: [...seqs].map(([roomId, lastSeq]) => ({ roomId, lastSeq })),
          denied: ids.filter((id) => !seqs.has(id)),
        });
        return;
      }
      case "room.unsubscribe":
        for (const id of ev.roomIds) this.unsubscribeRoom(conn, id);
        return;
      case "message.send":
        await this.onSend(conn, ev);
        return;
      case "typing": {
        if (!conn.rooms.has(ev.roomId)) {
          this.send(conn, { type: "error", code: "forbidden", message: "Subscribe to the channel first" });
          return;
        }
        const key = `${ev.roomId}|${ev.parentId ?? ""}`;
        const now = Date.now();
        if (now - (conn.typingLast.get(key) ?? 0) < LIMITS.typingServerMinIntervalMs) return; // throttled, silently
        conn.typingLast.set(key, now);
        await this.relay.bus
          .publish(topics.room(ev.roomId), { type: "typing", roomId: ev.roomId, parentId: ev.parentId ?? null, user: conn.user, at: now })
          .catch(() => undefined); // best effort
        return;
      }
      case "presence.request":
        await this.sendSnapshot(conn);
        return;
      case "bye":
        conn.byeReason = ev.reason;
        return;
      case "ping":
        this.send(conn, { type: "pong", t: ev.t, serverTime: Date.now() });
        return;
    }
  }

  private async onSend(conn: Conn, ev: Extract<ClientEvent, { type: "message.send" }>) {
    const { db, metrics, log } = this.relay;
    const fail = (code: MessageErrorEvent["code"], message: string, retryable: boolean) => {
      metrics.sendErrors++;
      this.send(conn, { type: "message.error", clientId: ev.clientId, code, message, retryable });
    };
    if (!conn.sendBucket.take()) return fail("rate_limited", "You're sending messages too quickly", true);
    // A sent message ends the typing burst: the next keystroke should announce typing again.
    conn.typingLast.delete(`${ev.roomId}|${ev.parentId ?? ""}`);

    const t0 = Date.now();
    let result;
    try {
      result = await sendMessage(db, { userId: conn.user.id, roomId: ev.roomId, clientId: ev.clientId, body: ev.body, parentId: ev.parentId ?? null });
    } catch (err) {
      if (err instanceof AppError) {
        const code = err.code === "forbidden" || err.code === "not_found" || err.code === "conflict" || err.code === "validation" ? err.code : "server";
        return fail(code, err.message, code === "server");
      }
      conn.log.error("send failed", { err });
      return fail("server", "The message couldn't be saved. It will be retried.", true);
    }
    metrics.recordCommit(Date.now() - t0);
    if (result.duplicate) metrics.messagesDuplicate++;
    else metrics.messagesCommitted++;

    // Publish only after commit. On a duplicate (sender retry) we publish again: delivery is
    // at-least-once and clients de-duplicate by message id, so this repairs a lost first publish.
    const event: BusEvent = { type: "message.new", message: result.message, committedAt: Date.now() };
    const topic = topics.room(ev.roomId);
    const published = await publishWithRetry(this.relay.bus, topic, event);
    if (!published) {
      metrics.publishFailures++;
      log.warn("publish failed after commit; delivering locally, remote clients recover by seq", { roomId: ev.roomId, seq: result.message.seq });
      this.dispatch(topic, event, JSON.stringify(event));
    }
    this.send(conn, { type: "message.ack", clientId: ev.clientId, message: result.message, duplicate: result.duplicate });
  }

  private async sendSnapshot(conn: Conn) {
    try {
      const recs = await this.relay.presence.snapshot();
      const users = await getUsersPublic(this.relay.db, [...new Set(recs.map((r) => r.userId))]);
      const entries: PresenceEntry[] = [];
      for (const r of recs) {
        const u = users.get(r.userId);
        if (u) entries.push({ user: u, connId: r.connId, expiresAt: r.expiresAt });
      }
      this.send(conn, { type: "presence.snapshot", entries, serverTime: Date.now() });
    } catch (err) {
      conn.log.warn("presence snapshot failed", { err: (err as Error).message });
    }
  }

  private async subscribeConn(conn: Conn, topic: string) {
    if (conn.topics.has(topic)) return;
    let lt = this.local.get(topic);
    if (!lt) {
      lt = { conns: new Set(), unsubscribe: this.relay.bus.subscribe(topic, (e, raw) => this.dispatch(topic, e, raw)) };
      this.local.set(topic, lt);
      lt.unsubscribe.catch(() => {
        if (this.local.get(topic) === lt) this.local.delete(topic);
      });
    }
    lt.conns.add(conn);
    conn.topics.add(topic);
    try {
      await lt.unsubscribe;
    } catch (err) {
      lt.conns.delete(conn);
      conn.topics.delete(topic);
      throw err;
    }
  }

  private unsubscribeTopic(conn: Conn, topic: string) {
    conn.topics.delete(topic);
    const lt = this.local.get(topic);
    if (!lt) return;
    lt.conns.delete(conn);
    if (lt.conns.size === 0) {
      this.local.delete(topic);
      lt.unsubscribe.then((un) => un(), () => undefined);
    }
  }

  private unsubscribeRoom(conn: Conn, roomId: string) {
    conn.rooms.delete(roomId);
    this.unsubscribeTopic(conn, topics.room(roomId));
  }

  private dispatch(topic: string, event: BusEvent, raw: string) {
    this.relay.metrics.busEventsIn++;
    const lt = this.local.get(topic);
    if (!lt) return;
    for (const conn of [...lt.conns]) {
      if (event.type === "membership.revoked") {
        if (event.userId === conn.user.id) {
          this.unsubscribeRoom(conn, event.roomId);
          this.sendRaw(conn, raw);
        }
        continue;
      }
      if (event.type === "typing" && event.user.id === conn.user.id) continue;
      this.sendRaw(conn, raw);
    }
  }

  private send(conn: Conn, ev: ServerEvent) {
    this.sendRaw(conn, JSON.stringify(ev));
  }

  private sendRaw(conn: Conn, raw: string) {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      conn.log.warn("closing slow consumer", { buffered: conn.ws.bufferedAmount });
      conn.ws.terminate();
      return;
    }
    conn.ws.send(raw);
  }

  private async onClose(conn: Conn, code: number) {
    if (!this.conns.delete(conn)) return;
    this.relay.metrics.connectionsOpen--;
    for (const t of conn.timers) clearTimeout(t);
    for (const topic of [...conn.topics]) this.unsubscribeTopic(conn, topic);
    const planned = conn.byeReason === "reconnect" || conn.serverClosedPlanned || code === CloseCodes.ServiceRestart;
    conn.log.debug("disconnected", { code, planned });
    try {
      await this.relay.presence.leave(conn.user.id, conn.id);
      // A planned reconnect is followed by a new connection's "online" within seconds; skip the
      // "offline" broadcast to save a publish per reconnect cycle. Clients drop the old connId on expiry.
      if (!planned) {
        await this.relay.bus.publish(topics.presence, {
          type: "presence.update",
          state: "offline",
          entry: { user: conn.user, connId: conn.id, expiresAt: Date.now() },
        });
      }
    } catch (err) {
      conn.log.warn("presence leave failed; record will expire on its own", { err: (err as Error).message });
    }
  }

  /** Graceful shutdown: tell clients to reconnect elsewhere (they add jitter), then stop. */
  async close(code: number = CloseCodes.ServiceRestart) {
    this.closing = true;
    for (const c of this.conns) {
      c.serverClosedPlanned = true;
      c.ws.close(code, "server restarting");
    }
    const deadline = Date.now() + 2_000;
    while (this.conns.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    for (const c of this.conns) c.ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
  }
}
