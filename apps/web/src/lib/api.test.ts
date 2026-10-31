import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("session restoration", () => {
  it("refreshes an expired access cookie before restoring the signed-in account", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(200, {})).mockResolvedValueOnce(reply(200, { user: { id: "me" } }));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    expect(await api.me()).toEqual({ user: { id: "me" } });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/auth/me", "/api/v1/auth/refresh", "/api/v1/auth/me"]);
  });
  it("shares one refresh request between concurrent expired-session responses", async () => {
    const attempts = new Map<string, number>();
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/auth/refresh")) return reply(200, {});
      const count = attempts.get(url) ?? 0;
      attempts.set(url, count + 1);
      return reply(count === 0 ? 401 : 200, {});
    });
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await Promise.all([api.me(), api.rooms()]);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
  });
  it("does not refresh incorrect login credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(reply(401, { error: { code: "unauthorized", message: "Incorrect credentials" } }));
    vi.stubGlobal("fetch", fetch);
    const { api } = await import("./api");
    await expect(api.login("user@example.com", "wrong")).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("ends the session when refresh is revoked instead of looping", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(401, {})).mockResolvedValueOnce(reply(401, {}));
    vi.stubGlobal("fetch", fetch);
    const { api, setSessionLostHandler } = await import("./api");
    const lost = vi.fn();
    setSessionLostHandler(lost);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
