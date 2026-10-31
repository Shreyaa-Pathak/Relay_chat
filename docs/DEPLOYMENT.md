# Deploying Relay on Vercel (Hobby) + Neon + Upstash

Everything below is $0 on the free tiers, but free tiers have limits and their terms change. Platform
facts were checked on **2026-10-29**; recheck them before you rely on them.

## Free-tier limits that matter

| Service | What Relay relies on | Limits / conditions |
| --- | --- | --- |
| Vercel Hobby | Static frontend, two Node.js functions, WebSockets (GA since 2026-10-20, requires Fluid compute) | **Non-commercial personal use only.** Function max duration **300 s** (default and max), so every WebSocket closes within 5 minutes. Function usage (Active CPU, provisioned memory while a connection is open, transfer) counts against Hobby's included usage; check **Usage** in week one. |
| Neon Free | Postgres | 0.5 GB storage per project and 100 compute-hours per project per month. Compute scales to zero after 5 minutes idle, so the first query after a pause is slower. No card required at signup (per Neon's pages). |
| Upstash Redis Free | Pub/sub and presence over TCP | 256 MB and **500,000 commands per month**. Subscribing requires the TCP endpoint (`rediss://`), not REST. Not verified: whether each delivered pub/sub message counts as a command. |

**Not promised:** that the app stays free forever, or that no payment method will ever be requested.
If Relay ever charges users or serves a business, Vercel requires a paid plan.

## 1. Neon

1. Create a Neon project in the region closest to your Vercel functions.
2. Copy the **pooled** connection string (the host contains `-pooler`) and keep `?sslmode=require`.

You can use a Neon branch for preview deployments, so previews don't migrate the production database.

## 2. Upstash

1. Create a Redis database in the same region.
2. Copy the **TCP** URL: `rediss://default:<password>@<endpoint>.upstash.io:6379`. The REST URL and
   token are not used.

You can also add both services through the Vercel Marketplace, which injects env vars. Relay reads only
the variable names in `.env.example`, so map the injected values onto those names if they differ.

## 3. Vercel project

1. Push the repository to GitHub under your **personal** account and import it in Vercel.
   - **Root directory:** repository root.
   - **Framework preset:** Other. `vercel.json` sets the install command, build command, output
     directory, function durations and rewrites.
2. Confirm **Fluid compute** is enabled under Settings → Functions. It's the default for projects
   created after 2025-04-23, and WebSockets require it.
3. Set these environment variables for Production:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Neon pooled URL |
   | `REDIS_URL` | Upstash `rediss://` URL |
   | `AUTH_SECRET` | Output of `openssl rand -base64 48` |
   | `APP_URL` | `https://<project>.vercel.app` (or your domain) |
   | `TRUSTED_ORIGINS` | Optional: extra origins, comma-separated |
   | `NODE_ENV` | `production` |

4. Deploy. The build runs `pnpm vercel-build`, which builds all packages, then applies migrations and
   seeds the four default channels. Both steps are idempotent, and both need `DATABASE_URL` at build
   time. To migrate manually instead, change the build command to `pnpm build` and run
   `DATABASE_URL=... pnpm db:setup` from your machine.

## 4. Verify

1. Open `https://<app>/api/v1/ready`. It should return `{"ok":true,"database":true,"bus":true}`.
   - A `503` with `"code":"config"` lists the missing variables by name; values are never shown.
2. Open the app in two browsers, register two accounts and check that:
   - messages appear live in the other browser;
   - the online count shows 2;
   - typing indicators and thread replies work.
3. Leave a tab open for six minutes. The status should stay **Connected** through the planned
   reconnect, and no messages should be missed.
4. Run the load test against the deployment (see `docs/TESTING.md`). Raise `REGISTER_LIMIT_PER_HOUR`
   for the run, then put it back.

## Not yet verified on a real deployment

None of these could be run from the build environment, because there are no Vercel, Neon or Upstash
credentials there.

- **Monorepo bundling:** Vercel tracing `@relay/server` (a pnpm workspace package compiled to `dist/`)
  into the `api/*.ts` function bundles.
- **REST rewrite:** whether Vercel keeps the original path in `req.url` for the `/api/v1/:path*` →
  `/api/server?__path=:path*` rewrite. The server handles both cases.
- **WebSocket upgrade:** the handshake reaching `api/ws.ts` with cookies and `Origin` intact.
- **Real latency and usage:** latency on Vercel and real Upstash command consumption.

If a deploy fails at one of these, the function logs on Vercel will name the problem.
`api/server.ts` and `api/ws.ts` are thin, so swapping in a different bundling approach is a small change.

## Local development

```bash
pnpm install
docker compose up -d                    # Postgres 16 + Redis 7 (also creates relay_test, relay_e2e)
cp .env.example .env
pnpm db:setup                           # migrations + seed
pnpm dev                                # API + WS on :3001, app on http://localhost:5173
```

Without Docker: point `DATABASE_URL` at any Postgres 16 and either run Redis locally or set
`RELAY_ALLOW_MEMORY_BUS=1`. The memory bus works only in a single local process, and the server
refuses it in production.
