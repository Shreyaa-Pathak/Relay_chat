import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HistoryQuery, LIMITS, LoginInput, RegisterInput, topics, uuid } from "@relay/shared";
import type { Relay } from "../context.js";
import { AppError } from "../errors.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, signAccessToken, verifyAccessToken } from "../auth/tokens.js";
import { ACCESS_COOKIE, clearCookie, parseCookies, REFRESH_COOKIE, REFRESH_COOKIE_PATH, serializeCookie } from "../auth/cookies.js";
import { createSession, revokeSession, rotateSession } from "../auth/sessions.js";
import { createUser, findUserByEmail, getMe } from "../repo/users.js";
import { assertMember, joinRoom, leaveRoom, listRooms, roomLastSeq } from "../repo/rooms.js";
import { channelHistory, getMessage, messagesAfter, threadReplies } from "../repo/messages.js";
import { KeyedLimiter } from "../ratelimit.js";
import { publishWithRetry } from "../bus/redis.js";
import { json, readJson, Router, send, type Req } from "./router.js";

export const API_PREFIX = "/api/v1";

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || (req.headers["x-real-ip"] as string | undefined) || req.socket.remoteAddress || "unknown";
}

export function isTrustedOrigin(relay: Relay, origin: string | undefined): boolean {
  return !!origin && relay.env.trustedOrigins.includes(origin);
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError("validation", r.error.issues[0]?.message ?? "Invalid input", r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return r.data;
}

/**
 * Resolves the API path. Locally the URL is /api/v1/...; on Vercel, vercel.json rewrites
 * /api/v1/:path* to /api/server?__path=:path*, and the original path may or may not be kept in req.url.
 */
export function resolvePath(rawUrl: string): { path: string; query: URLSearchParams } {
  const url = new URL(rawUrl, "http://local");
  const rewritten = url.searchParams.get("__path");
  url.searchParams.delete("__path");
  if (url.pathname.startsWith(API_PREFIX)) return { path: url.pathname.slice(API_PREFIX.length) || "/", query: url.searchParams };
  if (rewritten !== null) return { path: "/" + rewritten.replace(/^\/+/, ""), query: url.searchParams };
  return { path: url.pathname, query: url.searchParams };
}

export function createApi(relay: Relay) {
  const { db, env, log, metrics } = relay;
  const authLimiter = new KeyedLimiter(env.LOGIN_LIMIT_PER_MINUTE, env.LOGIN_LIMIT_PER_MINUTE / 60);
  const registerLimiter = new KeyedLimiter(env.REGISTER_LIMIT_PER_HOUR, env.REGISTER_LIMIT_PER_HOUR / 3600);
  const writeLimiter = new KeyedLimiter(30, 1);

  const authCookies = async (userId: string, refresh: string) => [
    serializeCookie(ACCESS_COOKIE, await signAccessToken(env.AUTH_SECRET, userId), { maxAgeS: ACCESS_TOKEN_TTL_S, path: "/", secure: env.secureCookies }),
    serializeCookie(REFRESH_COOKIE, refresh, { maxAgeS: REFRESH_TOKEN_TTL_S, path: REFRESH_COOKIE_PATH, secure: env.secureCookies }),
  ];
  const clearAuth = () => [clearCookie(ACCESS_COOKIE, "/", env.secureCookies), clearCookie(REFRESH_COOKIE, REFRESH_COOKIE_PATH, env.secureCookies)];

  async function requireUser(req: Req): Promise<string> {
    const userId = await verifyAccessToken(env.AUTH_SECRET, parseCookies(req.raw)[ACCESS_COOKIE]);
    if (!userId) throw new AppError("unauthorized", "Sign in to continue");
    return userId;
  }

  const r = new Router();

  r.add("GET", "/health", async () => json(200, { ok: true, metrics: metrics.snapshot() }));

  r.add("GET", "/ready", async () => {
    const [dbOk, busOk] = await Promise.all([
      db.execute("select 1").then(() => true, () => false),
      relay.bus.ping(),
    ]);
    return json(dbOk && busOk ? 200 : 503, { ok: dbOk && busOk, database: dbOk, bus: busOk });
  });

  r.add("POST", "/auth/register", async (req) => {
    if (!registerLimiter.take(req.ip)) throw new AppError("rate_limited", "Too many sign-ups from this network. Try again later.");
    const input = parse(RegisterInput, await req.body());
    const user = await createUser(db, { email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password) });
    const refresh = await createSession(db, user.id);
    log.info("user registered", { userId: user.id, requestId: req.requestId });
    return json(201, { user }, { "set-cookie": await authCookies(user.id, refresh) });
  });

  r.add("POST", "/auth/login", async (req) => {
    const input = parse(LoginInput, await req.body());
    if (!authLimiter.take(`${req.ip}|${input.email}`)) throw new AppError("rate_limited", "Too many sign-in attempts. Wait a minute and try again.");
    const row = await findUserByEmail(db, input.email);
    const ok = await verifyPassword(input.password, row?.password_hash ?? null);
    if (!row || !ok) throw new AppError("unauthorized", "Email or password is incorrect");
    const refresh = await createSession(db, row.id);
    const user = await getMe(db, row.id);
    return json(200, { user }, { "set-cookie": await authCookies(row.id, refresh) });
  });

  r.add("POST", "/auth/refresh", async (req) => {
    const token = parseCookies(req.raw)[REFRESH_COOKIE];
    if (!token) throw new AppError("unauthorized", "Session expired. Sign in again.");
    const rotated = await rotateSession(db, token);
    if (!rotated) return json(401, { error: { code: "unauthorized", message: "Session expired. Sign in again." } }, { "set-cookie": clearAuth() });
    const user = await getMe(db, rotated.userId);
    if (!user) return json(401, { error: { code: "unauthorized", message: "Account not found" } }, { "set-cookie": clearAuth() });
    return json(200, { user }, { "set-cookie": await authCookies(rotated.userId, rotated.token) });
  });

  r.add("POST", "/auth/logout", async (req) => {
    const token = parseCookies(req.raw)[REFRESH_COOKIE];
    if (token) await revokeSession(db, token);
    return json(200, { ok: true }, { "set-cookie": clearAuth() });
  });

  r.add("GET", "/auth/me", async (req) => {
    const userId = await requireUser(req);
    const user = await getMe(db, userId);
    if (!user) throw new AppError("unauthorized", "Account not found");
    return json(200, { user });
  });

  r.add("GET", "/rooms", async (req) => {
    const userId = await requireUser(req);
    return json(200, { rooms: await listRooms(db, userId) });
  });

  r.add("POST", "/rooms/:id/join", async (req) => {
    const userId = await requireUser(req);
    const roomId = parse(uuid, req.params.id);
    if (!writeLimiter.take(userId)) throw new AppError("rate_limited", "Slow down a little");
    await joinRoom(db, roomId, userId);
    return json(200, { ok: true });
  });

  r.add("POST", "/rooms/:id/leave", async (req) => {
    const userId = await requireUser(req);
    const roomId = parse(uuid, req.params.id);
    if (!writeLimiter.take(userId)) throw new AppError("rate_limited", "Slow down a little");
    const left = await leaveRoom(db, roomId, userId);
    if (left) {
      // Every instance drops this user's live subscription to the room.
      const ok = await publishWithRetry(relay.bus, topics.room(roomId), { type: "membership.revoked", roomId, userId });
      if (!ok) log.warn("membership.revoked publish failed; open sockets lose access at their next reconnect", { roomId });
    }
    return json(200, { ok: true });
  });

  r.add("GET", "/rooms/:id/messages", async (req) => {
    const userId = await requireUser(req);
    const roomId = parse(uuid, req.params.id);
    const q = parse(HistoryQuery, Object.fromEntries(req.query));
    await assertMember(db, roomId, userId);
    // Read last seq first: every message <= it is covered by this page set or by live events.
    const lastSeq = await roomLastSeq(db, roomId);
    if (q.afterSeq !== undefined) {
      const page = await messagesAfter(db, roomId, q.afterSeq, Math.min(q.limit ?? LIMITS.syncPageMax, LIMITS.syncPageMax));
      return json(200, { ...page, roomLastSeq: lastSeq });
    }
    const page = await channelHistory(db, roomId, { beforeSeq: q.beforeSeq, limit: Math.min(q.limit ?? LIMITS.historyPageDefault, LIMITS.historyPageMax) });
    return json(200, { ...page, roomLastSeq: lastSeq });
  });

  r.add("GET", "/messages/:id/replies", async (req) => {
    const userId = await requireUser(req);
    const parentId = parse(uuid, req.params.id);
    const q = parse(z.object({ afterSeq: z.coerce.number().int().nonnegative().optional(), limit: z.coerce.number().int().min(1).max(LIMITS.historyPageMax).optional() }), Object.fromEntries(req.query));
    const parent = await getMessage(db, parentId);
    if (!parent) throw new AppError("not_found", "Message not found");
    await assertMember(db, parent.roomId, userId);
    if (parent.parentId) throw new AppError("validation", "That message is a reply, not a thread");
    const page = await threadReplies(db, parentId, { afterSeq: q.afterSeq, limit: q.limit ?? LIMITS.historyPageDefault });
    return json(200, { parent, ...page });
  });

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const requestId = (req.headers["x-vercel-id"] as string | undefined) ?? randomUUID();
    const started = Date.now();
    const method = req.method ?? "GET";
    const { path, query } = resolvePath(req.url ?? "/");
    let status = 500;
    try {
      // CSRF: state-changing requests must come from a trusted origin and carry the custom header
      // (which a cross-site form can't set). Cookies are also SameSite=Lax.
      if (method !== "GET" && method !== "HEAD") {
        if (!isTrustedOrigin(relay, req.headers.origin)) throw new AppError("csrf", "Request origin is not allowed");
        if (req.headers["x-relay-csrf"] !== "1") throw new AppError("csrf", "Missing CSRF header");
      }
      const m = r.match(method, path);
      if (m === null) throw new AppError("not_found", `No route for ${method} ${path}`);
      if (m === "method") {
        status = 405;
        send(res, json(405, { error: { code: "method_not_allowed", message: "Method not allowed" } }));
        return;
      }
      const out = await m.handler({ raw: req, method, path, params: m.params, query, ip: clientIp(req), requestId, body: () => readJson(req) });
      status = out.status;
      send(res, out);
    } catch (err) {
      if (err instanceof AppError) {
        status = err.status;
        send(res, json(err.status, { error: { code: err.code, message: err.message, details: err.details } }));
      } else {
        status = 500;
        log.error("request failed", { requestId, path, err });
        send(res, json(500, { error: { code: "server", message: "Something went wrong on the server. Try again." } }));
      }
    } finally {
      if (path !== "/health") log.debug("http", { requestId, method, path, status, ms: Date.now() - started });
    }
  };
}
