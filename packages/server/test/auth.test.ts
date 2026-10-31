import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORIGIN, resetDb, startCluster, TestUser, type Cluster } from "./helpers.js";

let c: Cluster;
let base: string;
beforeAll(async () => {
  await resetDb();
  c = await startCluster(1);
  base = c.servers[0]!.url;
});
afterAll(async () => c.close());

describe("auth", () => {
  it("registers, sets httpOnly cookies and restores the session", async () => {
    const u = new TestUser(base);
    const r = await u.req("POST", "/auth/register", { email: "Ada@Example.com", password: "correct horse battery", displayName: "Ada" });
    expect(r.status).toBe(201);
    const cookies = r.res.headers.getSetCookie();
    expect(cookies.some((x) => x.startsWith("relay_at=") && x.includes("HttpOnly") && x.includes("SameSite=Lax"))).toBe(true);
    expect(cookies.some((x) => x.startsWith("relay_rt=") && x.includes("Path=/api/v1/auth"))).toBe(true);
    const me = await u.req("GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ displayName: "Ada", email: "ada@example.com" });
    // New users join the four default channels.
    const rooms = await u.rooms();
    expect(rooms.filter((x) => x.isMember).map((x) => x.slug).sort()).toEqual(["deploys", "design", "general", "random"]);
  });

  it("rejects duplicate emails case-insensitively", async () => {
    const u = new TestUser(base);
    const r = await u.req("POST", "/auth/register", { email: "ADA@example.com", password: "correct horse battery", displayName: "Ada 2" });
    expect(r.status).toBe(409);
  });

  it("validates input on the server", async () => {
    const u = new TestUser(base);
    const r = await u.req("POST", "/auth/register", { email: "nope", password: "short", displayName: "" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation");
  });

  it("logs in, rejects wrong passwords and unknown users with the same message", async () => {
    const u = new TestUser(base);
    const wrong = await u.req("POST", "/auth/login", { email: "ada@example.com", password: "wrong password!" });
    const unknown = await u.req("POST", "/auth/login", { email: "ghost@example.com", password: "whatever12345" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    const ok = await u.req("POST", "/auth/login", { email: "ada@example.com", password: "correct horse battery" });
    expect(ok.status).toBe(200);
  });

  it("rotates refresh tokens and treats reuse of an old token as theft", async () => {
    const u = await TestUser.register(base, "rot");
    const oldRt = u.cookies.get("relay_rt")!;
    const r1 = await u.req("POST", "/auth/refresh");
    expect(r1.status).toBe(200);
    expect(u.cookies.get("relay_rt")).not.toBe(oldRt);
    const thief = new TestUser(base);
    thief.cookies.set("relay_rt", oldRt);
    expect((await thief.req("POST", "/auth/refresh")).status).toBe(401);
    // Reuse revoked every session for that user, including the legitimate new one.
    expect((await u.req("POST", "/auth/refresh")).status).toBe(401);
  });

  it("logs out and clears cookies", async () => {
    const u = await TestUser.register(base, "bye");
    const r = await u.req("POST", "/auth/logout");
    expect(r.status).toBe(200);
    expect(u.cookies.size).toBe(0);
    expect((await u.req("GET", "/rooms")).status).toBe(401);
  });

  it("requires auth for protected endpoints", async () => {
    const anon = new TestUser(base);
    expect((await anon.req("GET", "/rooms")).status).toBe(401);
    expect((await anon.req("GET", "/auth/me")).status).toBe(401);
  });

  it("rejects forged and tampered access tokens", async () => {
    const u = await TestUser.register(base, "tamper");
    const at = u.cookies.get("relay_at")!;
    const [h, p] = at.split(".");
    u.cookies.set("relay_at", `${h}.${p}.invalidsignature`);
    expect((await u.req("GET", "/rooms")).status).toBe(401);
  });

  it("blocks state-changing requests without the CSRF header or from untrusted origins", async () => {
    const u = new TestUser(base);
    const body = { email: "csrf@example.com", password: "correct horse battery", displayName: "C" };
    expect((await u.req("POST", "/auth/register", body, { "x-relay-csrf": "" })).status).toBe(403);
    expect((await u.req("POST", "/auth/register", body, { origin: "https://evil.example" })).status).toBe(403);
    expect((await u.req("POST", "/auth/register", body, { origin: ORIGIN })).status).toBe(201);
  });

  it("rate-limits sign-in attempts", async () => {
    const limited = await startCluster(1, { env: { LOGIN_LIMIT_PER_MINUTE: "3" } });
    try {
      const u = new TestUser(limited.servers[0]!.url);
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await u.req("POST", "/auth/login", { email: "ada@example.com", password: "wrong password!" })).status);
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });

  it("serves health and readiness", async () => {
    const u = new TestUser(base);
    const h = await u.req("GET", "/health");
    expect(h.status).toBe(200);
    const r = await u.req("GET", "/ready");
    expect(r.body).toEqual({ ok: true, database: true, bus: true });
  });
});
