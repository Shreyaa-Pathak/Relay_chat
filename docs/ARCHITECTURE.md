# Architecture

Relay runs entirely on Vercel (Hobby) with Neon Postgres and Upstash Redis. Postgres is the source of
truth for every message; Redis only moves events between function instances and holds expiring presence.

```
 Browser (React)                    Vercel                                 Data
 ───────────────        ──────────────────────────────────         ─────────────────
 RelayConnection ─wss─▶ api/ws.ts      (Gateway, many instances) ─▶ Neon Postgres
   (make-before-break)     │  validate → lock room row →             users, sessions, rooms,
 ChatController            │  idempotency check → seq+1 →            memberships, messages
   (optimistic, seq        │  insert → COMMIT                        (room.last_seq counter)
    tracking, gap fill)    │  then PUBLISH room:{id} ───────────▶ Upstash Redis
                           │  ◀── SUBSCRIBE room:{id} (refcounted)    pub/sub + presence ZSET
 fetch /api/v1/* ──────▶ api/server.ts  (REST: auth, rooms, history, threads, health)
```

## Message flow

1. The client renders the message immediately with a fresh `clientId` (status *Sending…*).
2. `message.send` reaches whichever instance holds that socket. The gateway validates it with the
   shared Zod schema and applies a per-socket rate limit.
3. One Postgres transaction checks membership, locks the room row (`SELECT … FOR UPDATE`), and returns
   the existing row if `(author_id, client_id)` was already committed (idempotent retry). Otherwise it
   sets `seq = last_seq + 1`, inserts the message and bumps the parent's `reply_count` for thread replies.
   Any failure rolls back the counter too, so **committed seqs are unique and gap-free per room**. The
   concurrency integration test and the load test's teardown check both verify this.
4. Only after commit, the event is published to `room:{roomId}` (3 attempts with backoff).
5. Every instance with local subscribers for that room forwards it to its sockets.
6. The sender receives `message.ack` with the authoritative id and seq, and the bubble shows *Sent*.

## Delivery semantics

Delivery is at-least-once to connected clients, and storage is exactly-once. Clients de-duplicate by
`clientId`/id and order by `seq`, never by clocks. Nothing here claims exactly-once delivery across
Postgres and Redis.

| Failure | What happens |
| --- | --- |
| Publish fails after commit | The sender is still acked and this instance delivers locally. Remote clients see the next seq jump and fetch the gap over REST (`afterSeq`); every reconnect (≤ 5 min on Hobby) resyncs anyway. Postgres is effectively the outbox. |
| Redis subscriber drops | ioredis reconnects and resubscribes; the gateway sends `resync` and clients gap-fill. |
| Socket drops | The client backs off (exponential with jitter, 30 s cap), resubscribes, fetches `afterSeq=<last contiguous seq>`, and resends pending messages with their original `clientId`. |
| Browser goes offline | The client drops the socket at once (it can look open for a long time otherwise), keeps unsent messages queued, and reconnects on the browser's `online` event. |
| Ack lost | Pending messages are resent after 8 s with the same `clientId`; the server returns the original row. |
| Events arrive out of order across instances | `SeqTracker` waits 1.2 s for the missing seq before fetching. |

## History without races

On (re)connect the client sends `room.subscribe`. The server **activates the Redis subscription first**
and only then reads `rooms.last_seq`, returning it in `room.subscribed`. Everything after that seq
arrives live; everything up to it comes from REST. The client also buffers seqs seen before
`room.subscribed`.

## Connection lifecycle on Vercel

Verified against Vercel's WebSocket docs and limits pages (Oct 2026): a Node.js function may
default-export an `http.Server` with `ws` attached (requires Fluid compute); a connection is pinned to
one instance; new connections can land on any instance; connections close at the function's max
duration, which is **300 s on Hobby** (default and maximum).

- The gateway closes each socket itself at `WS_MAX_CONNECTION_MS` (default 290 s) with code 4000.
- The client starts a **planned reconnect at 80–95 % of that lifetime** (about 232–275 s with the
  defaults). It opens the new socket, waits for `hello`, then sends `bye` and closes the old one, so
  there is no window without a socket.
- Presence records last `maxConnectionMs + 60 s`, so the reconnect gap never shows a user offline.
- Serverless instances can be frozen or reclaimed without a signal; Relay keeps no durable state in
  process memory, and the `SIGTERM` drain (close code 1012) is best effort.

## Presence and typing

- Presence is one Redis ZSET member per **connection** (`userId|connId`, score = expiry). Closing one
  tab removes only that connection, so a user stays online while any tab is open. Abrupt disconnects
  expire on their own. Counts come from shared state, not a process counter.
- Typing is published to the room topic, never stored. Clients send at most once per 3 s per
  room/thread, the server drops anything faster than 2.5 s (reset when a message is sent), and
  indicators expire after 5 s.

## Redis command budget (Upstash Free: 500K commands/month)

Each connection cycle costs `ZADD` + `ZRANGEBYSCORE` (snapshot) + `PUBLISH` (online) on connect, plus
`ZREM` on close; planned reconnects skip the offline publish. Each message costs one `PUBLISH`. Room
`SUBSCRIBE`s are reference-counted per instance with a 30 s linger, so reconnect churn doesn't add
commands. The Upstash pages checked don't say whether each *delivered* pub/sub message also counts, so
**check the Upstash usage page after the first week**.

## Data model

| Table | Holds |
| --- | --- |
| `users` | Accounts |
| `sessions` | Hashed refresh tokens |
| `rooms` | `last_seq` counter, `is_private`, `is_default` |
| `memberships` | Primary key on room + user |
| `messages` | `seq`, `client_id`, `parent_id`, `reply_count` |

| Index | Purpose |
| --- | --- |
| Unique `(room_id, seq)` | One sequence number per message per room |
| Unique `(author_id, client_id)` | Idempotent retries |
| Partial `(room_id, seq) WHERE parent_id IS NULL` | Channel paging |
| `(parent_id, seq)` | Thread paging |

Threads are one level deep.

## Code map

| Path | What |
| --- | --- |
| `packages/shared` | Zod schemas, event protocol, limits, close codes |
| `packages/server/src/ws/gateway.ts` | Connection lifecycle, send path, typing, presence, fan-out |
| `packages/server/src/repo/messages.ts` | Transactional send and sequence allocator; history queries |
| `packages/server/src/bus/redis.ts` | `RedisBus`: separate pub/sub connections, refcounts, recovery |
| `packages/server/src/http/app.ts` | REST API, CSRF/origin checks, auth |
| `packages/server/src/vercel.ts`, `api/*.ts` | Vercel Function entry points |
| `apps/web/src/realtime/connection.ts` | Socket lifecycle: backoff, make-before-break, offline |
| `apps/web/src/state/controller.ts` | Optimistic sends, resend, seq tracking, gap fill |
