import { describe, expect, it } from "vitest";
import { backoffDelay, plannedReconnectDelay } from "./backoff";
import { activeTypers, addTyping, TypingThrottle, typingLabel } from "./typing";
import { fromSnapshot, offline, online, onlineUsers } from "../state/presence";

const u = (id: string, name: string) => ({ id, displayName: name, avatarColor: "amber" as const });

describe("backoff", () => {
  it("grows exponentially and caps at 30 s, with jitter", () => {
    expect(backoffDelay(0, 500, 30_000, () => 0)).toBe(250);
    expect(backoffDelay(0, 500, 30_000, () => 1)).toBe(500);
    expect(backoffDelay(3, 500, 30_000, () => 1)).toBe(4000);
    expect(backoffDelay(20, 500, 30_000, () => 1)).toBe(30_000);
    expect(backoffDelay(20, 500, 30_000, () => 0)).toBe(15_000);
  });
  it("plans the reconnect between 80% and 95% of the server's max lifetime", () => {
    expect(plannedReconnectDelay(300_000, () => 0)).toBe(240_000);
    expect(plannedReconnectDelay(300_000, () => 1)).toBe(285_000);
  });
});

describe("typing", () => {
  it("sends at most once per 3 s per room/thread", () => {
    const t = new TypingThrottle(3000);
    expect(t.shouldSend("r|", 0)).toBe(true);
    expect(t.shouldSend("r|", 2999)).toBe(false);
    expect(t.shouldSend("r|p", 100)).toBe(true);
    expect(t.shouldSend("r|", 3000)).toBe(true);
    t.reset("r|");
    expect(t.shouldSend("r|", 3001)).toBe(true);
  });
  it("expires indicators 5 s after the last refresh", () => {
    let s = addTyping({}, "k", u("1", "Ada"), 1000);
    s = addTyping(s, "k", u("2", "Bo"), 3000);
    expect(activeTypers(s, "k", 6500, 5000).map((x) => x.displayName)).toEqual(["Bo"]);
    expect(activeTypers(s, "k", 8001, 5000)).toEqual([]);
    expect(typingLabel([u("1", "Ada"), u("2", "Bo")])).toBe("Ada and Bo are typing…");
  });
});

describe("presence", () => {
  it("keeps a user online while any tab is connected and drops expired connections", () => {
    let s = fromSnapshot([
      { user: u("1", "Ada"), connId: "tab1", expiresAt: 10_000 },
      { user: u("1", "Ada"), connId: "tab2", expiresAt: 20_000 },
      { user: u("2", "Bo"), connId: "x", expiresAt: 10_000 },
    ]);
    s = offline(s, "1", "tab1");
    expect(onlineUsers(s, 5000).map((x) => x.displayName)).toEqual(["Ada", "Bo"]);
    // Bo's only connection died abruptly (no offline event): he drops off when it expires.
    expect(onlineUsers(s, 15_000).map((x) => x.displayName)).toEqual(["Ada"]);
    s = online(s, { user: u("2", "Bo"), connId: "y", expiresAt: 30_000 });
    expect(onlineUsers(s, 15_000)).toHaveLength(2);
  });
});
