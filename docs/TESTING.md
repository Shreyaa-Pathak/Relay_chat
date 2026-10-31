# Testing

| Suite | Command | Needs |
| --- | --- | --- |
| Unit (shared, server, web) | `pnpm test` | Nothing |
| Integration | `pnpm test:integration` | Postgres + Redis (`docker compose up -d`) |
| End-to-end (Playwright, Chromium) | `pnpm build && pnpm test:e2e` | Postgres + Redis; `relay_e2e` database |
| Load (k6) | `k6 run load/k6-chat.js -e BASE_URLS=...` | A running deployment or local servers |

Integration tests start **two server instances** in one process. Each has its own Redis connections,
and both share Postgres and Redis, so cross-instance delivery is exercised for real, not mocked.

## Results recorded on 2026-10-29

**Environment:** a local sandbox (Ubuntu 24.04, 1 vCPU, Node 22.22, PostgreSQL 16.15, Redis server from
Ubuntu's packages, Chromium 141 via Playwright 1.56.1). **Not** Vercel, Neon or Upstash.

| Suite | Result |
| --- | --- |
| Shared schema tests | 6 / 6 passed |
| Server unit tests | 8 / 8 passed |
| Web unit tests (reconciliation, seq tracking, gap fill, reconnect, offline, backoff, typing, presence) | 30 / 30 passed |
| Server integration tests (real Postgres + Redis, 2 instances) | 33 / 33 passed |
| Playwright end-to-end (desktop + mobile, 2 browsers) | 9 / 9 passed |
| Lint (ESLint) and type-check (all packages + `api/`) | Pass |

The integration and E2E suites cover:

- **Auth:** register, login, refresh rotation and reuse detection, logout, CSRF and origin rejection,
  and tampered tokens.
- **WebSocket handshake:** rejects untrusted origins and missing tokens.
- **Messaging:** cross-instance delivery, idempotent retries, 60 concurrent sends from 4 sockets on 2
  instances getting contiguous seqs, and invalid payloads.
- **Authorization:** private-room access, and leaving a room revoking live access on another instance.
- **History and threads:** history paging, `afterSeq` gap fill, reply counts, threads kept out of the
  timeline, and nested and cross-room replies refused.
- **Typing:** throttling, no echo to the sender, never persisted, and reset after a send.
- **Presence:** multi-tab presence, and no offline broadcast on a planned reconnect.
- **Failure recovery:** a Redis publish failure followed by REST recovery; killing the Redis
  subscriber, then resync; max-lifetime close (4000); graceful shutdown (1012).
- **Rate limits:** message bursts and login attempts.
- **Browser:** live two-browser chat, optimistic and *Sent* states, threads, typing appearing and
  expiring, offline queueing and delivery on reconnect, reload persistence, sign-out confirmation,
  leaving and rejoining, axe scans (no serious or critical violations), the wrong-password error, and
  the mobile drawer with a full-screen thread.

### Load test (local, 2 instances)

The command was:

`k6 run load/k6-chat.js -e BASE_URLS=http://localhost:3001,http://localhost:3002 -e VUS=100 -e DURATION=2m`

Workload: 100 virtual users split across two server instances, all in #general, each sending one
message about every 6 s and reconnecting every 60 s. All of this ran on the same 1-vCPU machine as
Postgres, Redis and k6.

| Metric | Result |
| --- | --- |
| Messages sent / acked / persisted | 1,800 / 1,800 / 1,800 |
| Failed sends | 0 |
| Sequence numbers after the run | Contiguous (verified in the database by the teardown) |
| Live seq gaps seen by clients | 0 |
| Unexpected WebSocket closes | 0 (200 sessions) |
| Deliveries (fan-out to 100 users) | 180,000 |
| Send → ack | median 27 ms, p90 171 ms, p95 414 ms |
| Send → receive (incl. cross-instance) | median 26 ms, p90 165 ms, **p95 409 ms** |

**The brief's p95 < 80 ms target was not met in this environment.** The tail is dominated by CPU
contention: k6 parsed about 1,270 frames per second on the same single core as both servers and both
databases. This number says nothing either way about Vercel. The brief's other figures (50k
messages/min, 5,000+ concurrent users) were not tested. They describe the full multi-node architecture,
not the Hobby variant. No app rating exists yet.

## Not run

- Any test against a real Vercel, Neon or Upstash deployment (no credentials were available). See the
  "Not yet verified" list in `DEPLOYMENT.md`.
- A load test on Vercel. Before running one, raise `REGISTER_LIMIT_PER_HOUR`, start at around 100
  users, and watch Upstash's command count, since a 2-minute run at 100 users uses thousands of
  commands.
