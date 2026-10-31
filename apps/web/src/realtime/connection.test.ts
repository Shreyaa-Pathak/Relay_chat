import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCodes } from "@relay/shared";
import { RelayConnection } from "./connection";
import { FakeSocket } from "../test/fakeSocket";

let conn: RelayConnection;
const statuses: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  statuses.length = 0;
  conn = new RelayConnection({ url: "ws://x/api/ws", createSocket: (u) => new FakeSocket(u), rand: () => 0.5 });
  conn.on("status", (s) => statuses.push(s));
});
afterEach(() => {
  conn.stop();
  vi.useRealTimers();
});

describe("RelayConnection", () => {
  it("reports waking when the first connection is slow (cold start)", () => {
    conn.connect();
    expect(conn.getStatus()).toBe("connecting");
    vi.advanceTimersByTime(2600);
    expect(conn.getStatus()).toBe("waking");
    FakeSocket.all[0]!.hello();
    expect(conn.getStatus()).toBe("open");
  });

  it("backs off exponentially with jitter after unexpected drops, and resets after success", () => {
    conn.connect();
    FakeSocket.all[0]!.hello();
    FakeSocket.all[0]!.serverClose(1006);
    expect(conn.getStatus()).toBe("reconnecting");
    vi.advanceTimersByTime(374); // attempt 0: 250..500ms; rand 0.5 -> 375
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.serverClose(1006);
    vi.advanceTimersByTime(749); // attempt 1: 500..1000 -> 750
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.hello();
    expect(conn.getStatus()).toBe("open");
  });

  it("opens the replacement socket before closing the old one (make-before-break)", () => {
    const ready = vi.fn();
    conn.on("ready", ready);
    conn.connect();
    const first = FakeSocket.all[0]!;
    first.hello(100_000);
    expect(ready).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(87_500); // 0.8 + 0.5*0.15 = 87.5%
    expect(FakeSocket.all).toHaveLength(2);
    expect(first.closedWith).toBeNull(); // old one still open while the new one handshakes
    expect(conn.send({ type: "ping", t: 1 })).toBe(true);
    expect(first.sentOfType("ping")).toHaveLength(1);
    const second = FakeSocket.all[1]!;
    second.hello(100_000);
    expect(first.sentOfType("bye")).toEqual([{ type: "bye", reason: "reconnect" }]);
    expect(first.closedWith).toBe(CloseCodes.PlannedReconnect);
    expect(ready).toHaveBeenCalledTimes(2);
    conn.send({ type: "ping", t: 2 });
    expect(second.sentOfType("ping")).toHaveLength(1);
    expect(statuses.filter((s) => s === "reconnecting")).toHaveLength(0);
  });

  it("reconnects immediately (small jitter) when the server ends the connection at max lifetime", () => {
    conn.connect();
    FakeSocket.all[0]!.hello();
    FakeSocket.all[0]!.serverClose(CloseCodes.MaxDuration);
    vi.advanceTimersByTime(250);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("emits unauthorized on 4401 and does not retry on its own", () => {
    const unauth = vi.fn();
    conn.on("unauthorized", unauth);
    conn.connect();
    FakeSocket.all[0]!.serverClose(CloseCodes.Unauthorized);
    expect(unauth).toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("drops the socket when the browser goes offline and reconnects at once when it's back", () => {
    conn.connect();
    FakeSocket.all[0]!.hello();
    conn.markOffline();
    expect(conn.getStatus()).toBe("offline");
    expect(FakeSocket.all[0]!.closedWith).toBe(1000);
    expect(conn.send({ type: "ping", t: 1 })).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1); // no retry storm while offline
    conn.nudge();
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.hello();
    expect(conn.getStatus()).toBe("open");
  });

  it("refuses to send while disconnected so callers keep messages queued", () => {
    conn.connect();
    expect(conn.send({ type: "ping", t: 1 })).toBe(false);
  });

  it("ignores malformed server frames", () => {
    const ev = vi.fn();
    conn.on("event", ev);
    conn.connect();
    FakeSocket.all[0]!.hello();
    FakeSocket.all[0]!.onmessage?.({ data: "{not json" });
    FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: "message.new", nope: 1 }) });
    expect(ev).not.toHaveBeenCalled();
  });
});
