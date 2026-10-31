# Relay

A self-owned, real-time community chat app with channels, threads, presence, typing indicators,
reliable delivery and recoverable connections.

**Live site:** [getrelaychat.vercel.app](https://getrelaychat.vercel.app/)

![Relay chat showing the general channel, live messages, online members, and message composer](docs/images/relay-chat.png)

- **Frontend:** React 19, Vite 7, Tailwind 4, React Router 7, react-virtuoso, Zustand, Radix Dialog,
  and lucide icons.
- **Backend:** Node.js 22 and TypeScript on Vercel Functions, with `ws` WebSockets, Drizzle ORM on
  Postgres, ioredis pub/sub, Zod, jose JWTs and bcrypt.
- **Repo:** pnpm workspaces containing `apps/web`, `packages/server`, `packages/shared` and `api/` (the
  Vercel functions).

## Quick start (local)

Requires Node 22+, pnpm 9, and Docker (or your own Postgres 16 and Redis).

```bash
pnpm install
docker compose up -d
cp .env.example .env
pnpm dev             # app http://localhost:5173  (API/WS proxied to :3001)
```

`pnpm dev` applies pending database migrations and seeds the default channels (#general, #design,
#deploys, #random) before starting the servers. If database preparation fails, startup stops so the
app can't run against an outdated schema.

Open the app in two browser windows, create two accounts, and start chatting.

## Communities and roles

Relay is organised into **communities**. Each one has its own channels, owners and members. Communities
are either **public** (anyone can join) or **private** (invitation only).

There are three kinds of account:

| Role | Who | What they can do |
| --- | --- | --- |
| **Member** | Everyone | Chat, join public communities, and browse and join channels |
| **Community owner** | Assigned by the superadmin | Manage channels, members and invitations in their own community |
| **Superadmin** | The first account created | Manage every community and account on the platform |

### Members

New accounts can chat straight away in the default public community.

- **Discover communities** (the globe icon next to the community switcher) lists public communities
  you can join without approval.
- The **community switcher** at the top of the sidebar moves you between communities you've joined.
- **Browse channels** (the compass icon next to the "Channels" heading) lists the channels in the
  current community.

### Community owners

Owners get **Create channel** (the **+** icon next to the "Channels" heading) and an **Admin tools**
section at the bottom of the sidebar, which contains:

- **Invite people:** create, revoke and refresh invitation links. See [Invitations](#invitations).
- **Members and channels:** search and filter members, then:
  - **Access** adds or removes people from a channel. Use it to choose who can see a private channel.
  - **Block** removes a member from this community only. **Restore** gives them back access to the
    community's default channels.
  - **Delete** removes a channel along with all its messages and threads.

### Superadmin

The first account to sign up becomes the superadmin and owns the default community. Under
**Admin tools → Manage communities**, the superadmin can:

- Create public or private communities.
- Assign or replace a community's owner. The new owner must already have an active account.
- Suspend and restore communities.
- Suspend and restore accounts across the whole platform.

> Being superadmin does **not** grant access to conversations in private communities.

### Invitations

Private communities are joined by invitation:

1. An owner creates an invitation for a specific email address in **Invite people**.
2. The owner sends the link to that person themselves. Relay doesn't send email.
3. The invited person opens the link while signed in with that email address. If they don't have an
   account yet, they sign up from the link first and then accept the invitation.

Each link works once and expires after **seven days**. **New link** creates a replacement and stops
the old link from working.

## Hosting costs

Relay runs entirely on free tiers: Vercel Hobby, Neon Free and Upstash Free, with no extra
services or paid plans. Vercel Hobby is for personal, non-commercial use, and free-tier usage limits
still apply. See [Deployment](docs/DEPLOYMENT.md) for details.

## Scripts

| Command | Does |
| --- | --- |
| `pnpm dev` | Migrate + seed, then API/WebSocket server (watch) + Vite dev server |
| `pnpm build` | Build shared, server and web |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript across the repo |
| `pnpm test` | Unit tests (no services needed) |
| `pnpm test:integration` | Server tests against real Postgres + Redis, two instances |
| `pnpm test:e2e` | Playwright, desktop + mobile (run `pnpm build` first) |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:setup` | Drizzle migrations and idempotent seed |
| `k6 run load/k6-chat.js` | Load test; see `docs/TESTING.md` |

## Environment

All variables are documented in [`.env.example`](.env.example). The server validates them at startup;
if any are missing, the app shows a setup screen naming them (values are never shown).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres (Neon pooled URL in production) |
| `REDIS_URL` | yes* | Upstash TCP URL `rediss://…` (*local single-process dev may set `RELAY_ALLOW_MEMORY_BUS=1` instead) |
| `AUTH_SECRET` | yes | ≥ 32 chars, signs access tokens |
| `APP_URL` | yes | Public origin; trusted for CSRF and WebSocket origin checks |
| `TRUSTED_ORIGINS` | no | Extra allowed origins |
| `WS_MAX_CONNECTION_MS` | no | Server-side socket lifetime (default 290000, under Hobby's 300 s) |

## Docs

- [Architecture](docs/ARCHITECTURE.md): message flow, delivery semantics, reconnection, presence, data
  model, Redis budget.
- [Deployment](docs/DEPLOYMENT.md): Vercel, Neon and Upstash setup, free-tier limits, and
  post-deploy checks.
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md): how to run each suite and the recorded results.

## Known limitations

- **Connection lifetime:** Hobby closes every WebSocket within 300 s. Relay reconnects
  make-before-break and resyncs by sequence number, but every connection still churns every few
  minutes.
- **Rate limits are per function instance,** not global. Use Vercel Firewall rules for global limits.
- **Missing features:** no message editing or deletion, no file uploads, and no Storybook.

## License

Copyright (c) 2026 Shreya Pathak. All rights reserved. This code is shared for viewing only; it may
not be copied, modified, redistributed or deployed without written permission. See `LICENSE`.
