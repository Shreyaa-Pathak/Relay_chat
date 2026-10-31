import { describe, expect, it } from "vitest";
import { ConfigError, loadEnv } from "./env.js";
import { resolvePath } from "./http/app.js";
import { createLogger } from "./log.js";
import { KeyedLimiter, TokenBucket } from "./ratelimit.js";
import { signAccessToken, verifyAccessToken } from "./auth/tokens.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  REDIS_URL: "rediss://default:x@example.upstash.io:6379",
  AUTH_SECRET: "x".repeat(40),
  APP_URL: "https://relay.example.com",
};

describe("env", () => {
  it.each([
    { TRUSTED_ORIGINS: "not-a-url" },
    { REDIS_URL: "https://redis-rest.example.com" },
    { DATABASE_URL: "https://not-postgres.example.com" },
  ])("reports invalid connection/origin configuration without crashing: %j", async (invalid) => {
    expect(() => loadEnv({ ...base, ...invalid })).toThrow(ConfigError);
  });
  it("refuses the published example signing secret in production", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", AUTH_SECRET: "change-me-to-a-long-random-string-of-at-least-32-chars" })).toThrow(/Replace the example AUTH_SECRET/);
  });
  it("derives trusted origins and secure cookies", () => {
    const env = loadEnv({ ...base, TRUSTED_ORIGINS: "https://preview.example.com/, http://localhost:5173" });
    expect(env.trustedOrigins).toEqual(["https://relay.example.com", "https://preview.example.com", "http://localhost:5173"]);
    expect(env.secureCookies).toBe(true);
    expect(env.WS_MAX_CONNECTION_MS).toBe(290_000);
  });
  it("names every missing variable with an actionable message", () => {
    try {
      loadEnv({});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const vars = (e as ConfigError).issues.map((i) => i.variable);
      expect(vars).toEqual(expect.arrayContaining(["DATABASE_URL", "AUTH_SECRET", "APP_URL"]));
    }
  });
  it("requires Redis unless the memory bus is explicitly allowed, and never in production", () => {
    expect(() => loadEnv({ ...base, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
    expect(loadEnv({ ...base, REDIS_URL: undefined, RELAY_ALLOW_MEMORY_BUS: "1" }).RELAY_ALLOW_MEMORY_BUS).toBe("1");
    expect(() => loadEnv({ ...base, REDIS_URL: undefined, RELAY_ALLOW_MEMORY_BUS: "1", NODE_ENV: "production" })).toThrow(/production/);
  });
});

describe("resolvePath", () => {
  it("handles local and Vercel-rewritten URLs", () => {
    expect(resolvePath("/api/v1/rooms/abc/messages?limit=5").path).toBe("/rooms/abc/messages");
    const r = resolvePath("/api/server?__path=rooms/abc/messages&limit=5");
    expect(r.path).toBe("/rooms/abc/messages");
    expect(r.query.get("limit")).toBe("5");
    expect(r.query.has("__path")).toBe(false);
  });
});

describe("logger", () => {
  it("does not leak database query parameters through wrapped errors", () => {
    const lines: string[] = [];
    const log = createLogger("error", {}, (line) => lines.push(line));
    const cause = Object.assign(new Error("Database failure"), { code: "42P01" });
    log.error("failed", { err: new Error("Failed query: insert into messages values ($1)\nparams: private conversation", { cause }) });
    expect(lines[0]).not.toContain("private conversation");
    expect(JSON.parse(lines[0]!).err).toMatchObject({ message: "Database query failed", code: "42P01" });
  });
  it("redacts secrets and message bodies", () => {
    const lines: string[] = [];
    const log = createLogger("debug", { svc: "t" }, (l) => lines.push(l));
    log.info("x", { password: "hunter2", nested: { token: "abc", body: "private message", ok: 1 } });
    expect(lines[0]).not.toContain("hunter2");
    expect(lines[0]).not.toContain("private message");
    expect(JSON.parse(lines[0]!).nested).toEqual({ token: "[redacted]", body: "[redacted]", ok: 1 });
  });
});

describe("rate limiting", () => {
  it("token bucket refills over time", () => {
    const b = new TokenBucket(2, 1, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.take(1000)).toBe(true);
  });
  it("keyed limiter is bounded", () => {
    const l = new KeyedLimiter(1, 0, 2);
    expect(l.take("a", 0)).toBe(true);
    expect(l.take("a", 0)).toBe(false);
    l.take("b", 0);
    l.take("c", 0); // evicts "a"
    expect(l.take("a", 0)).toBe(true);
  });
});

describe("access tokens", () => {
  it("expire after 15 minutes", async () => {
    const t = await signAccessToken("s".repeat(40), "00000000-0000-4000-8000-000000000000", Date.now() - 16 * 60_000);
    expect(await verifyAccessToken("s".repeat(40), t)).toBeNull();
    const fresh = await signAccessToken("s".repeat(40), "00000000-0000-4000-8000-000000000000");
    expect(await verifyAccessToken("s".repeat(40), fresh)).toBe("00000000-0000-4000-8000-000000000000");
    expect(await verifyAccessToken("t".repeat(40), fresh)).toBeNull();
  });
});
