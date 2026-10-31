import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { ChatController } from "./controller";
import { initialChatState, type ChatState } from "./store";
import { timeline, thread } from "./messages";
import { FakeSocket, ME, msg, OTHER, ROOM } from "../test/fakeSocket";

const apiMock = vi.hoisted(() => ({
  rooms: vi.fn(),
  history: vi.fn(),
  after: vi.fn(),
  replies: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  api: apiMock,
  ApiError: class extends Error {},
  refreshSession: vi.fn(async () => true),
}));

const room = { id: ROOM, slug: "general", name: "general", topic: null, isPrivate: false, isMember: true, lastSeq: 0, memberCount: 2 };
let store: UseBoundStore<StoreApi<ChatState>>;
let ctl: ChatController;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(async () => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  for (const f of Object.values(apiMock)) f.mockReset();
  apiMock.rooms.mockResolvedValue({ rooms: [room] });
  store = create<ChatState>(() => initialChatState());
  ctl = new ChatController(ME, { onSignedOut: vi.fn() }, { url: "ws://x", createSocket: (u) => new FakeSocket(u), rand: () => 0.5 }, store);
  await ctl.start();
});
afterEach(() => {
  ctl.stop();
  vi.useRealTimers();
});

const sock = () => FakeSocket.all.at(-1)!;
const tl = () => timeline(store.getState().messages[ROOM]!);

describe("ChatController", () => {
  it("subscribes after the handshake, then loads history up to the subscribed seq", async () => {
    apiMock.history.mockResolvedValue({ messages: [msg(1), msg(2)], hasMore: false, roomLastSeq: 2 });
    sock().hello();
    expect(sock().sentOfType("room.subscribe")).toEqual([{ type: "room.subscribe", roomIds: [ROOM] }]);
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 2 }], denied: [] });
    await flush();
    expect(tl().map((m) => m.seq)).toEqual([1, 2]);
  });

  it("merges live messages that arrive while history is loading, without duplicates or gaps", async () => {
    let resolveHistory!: (v: unknown) => void;
    apiMock.history.mockReturnValue(new Promise((r) => (resolveHistory = r)));
    sock().hello();
    const m3 = msg(3);
    sock().push({ type: "message.new", message: msg(3, { clientId: m3.clientId, id: m3.id }), committedAt: 0 }); // before room.subscribed
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 2 }], denied: [] });
    sock().push({ type: "message.new", message: msg(4), committedAt: 0 });
    resolveHistory({ messages: [msg(1), msg(2)], hasMore: false, roomLastSeq: 2 });
    await flush();
    sock().push({ type: "message.new", message: m3, committedAt: 0 }); // duplicate delivery
    await vi.advanceTimersByTimeAsync(2000);
    expect(tl().map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(apiMock.after).not.toHaveBeenCalled(); // no gap, so no gap fill
  });

  it("fills a gap over REST when a seq is skipped", async () => {
    apiMock.history.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 5 });
    apiMock.after.mockResolvedValue({ messages: [msg(6)], hasMore: false, roomLastSeq: 7 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 5 }], denied: [] });
    await flush();
    sock().push({ type: "message.new", message: msg(7), committedAt: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(apiMock.after).not.toHaveBeenCalled(); // grace period for out-of-order delivery
    await vi.advanceTimersByTimeAsync(1000);
    expect(apiMock.after).toHaveBeenCalledWith(ROOM, 5);
    expect(tl().map((m) => m.seq)).toEqual([6, 7]);
  });

  it("shows sends immediately, queues them while offline, and resends with the same clientId after reconnect", async () => {
    apiMock.history.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 0 });
    apiMock.after.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 0 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 0 }], denied: [] });
    await flush();
    sock().serverClose(1006); // connection drops
    const clientId = ctl.send(ROOM, "  sent while offline  ")!;
    expect(tl()[0]).toMatchObject({ body: "sent while offline", status: "pending" });
    await vi.advanceTimersByTimeAsync(400);
    const s2 = sock();
    s2.hello();
    s2.push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 0 }], denied: [] });
    await flush();
    expect(s2.sentOfType("message.send")).toEqual([expect.objectContaining({ clientId, body: "sent while offline" })]);
    s2.push({ type: "message.ack", clientId, duplicate: false, message: { ...msg(1, { clientId, author: { ...OTHER, id: ME.id } }), body: "sent while offline" } });
    expect(tl()).toHaveLength(1);
    expect(tl()[0]).toMatchObject({ status: "sent", seq: 1 });
  });

  it("re-sends an unacknowledged message with the same clientId if no ack arrives", async () => {
    apiMock.history.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 0 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 0 }], denied: [] });
    await flush();
    const clientId = ctl.send(ROOM, "hello")!;
    await vi.advanceTimersByTimeAsync(10_500);
    const sends = sock().sentOfType("message.send");
    expect(sends.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sends.map((s) => s.clientId))).toEqual(new Set([clientId]));
  });

  it("marks non-retryable errors as failed and lets the user retry or discard", async () => {
    apiMock.history.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 0 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 0 }], denied: [] });
    await flush();
    const clientId = ctl.send(ROOM, "x")!;
    sock().push({ type: "message.error", clientId, code: "server", message: "Couldn't save", retryable: true });
    expect(tl()[0]).toMatchObject({ status: "failed", error: "Couldn't save" });
    ctl.retry(ROOM, clientId);
    expect(tl()[0]!.status).toBe("pending");
    expect(sock().sentOfType("message.send").at(-1)).toMatchObject({ clientId });
    sock().push({ type: "message.error", clientId, code: "validation", message: "Too long", retryable: false });
    ctl.discard(ROOM, clientId);
    expect(tl()).toHaveLength(0);
  });

  it("gap-fills after a reconnect when the room moved on", async () => {
    apiMock.history.mockResolvedValue({ messages: [msg(1)], hasMore: false, roomLastSeq: 1 });
    apiMock.after.mockResolvedValue({ messages: [msg(2), msg(3, { parentId: "x" })], hasMore: false, roomLastSeq: 3 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 1 }], denied: [] });
    await flush();
    sock().serverClose(4000);
    await vi.advanceTimersByTimeAsync(300);
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 3 }], denied: [] });
    await flush();
    expect(apiMock.after).toHaveBeenCalledWith(ROOM, 1);
    expect(tl().map((m) => m.seq)).toEqual([1, 2]);
    expect(thread(store.getState().messages[ROOM]!, "x").map((m) => m.seq)).toEqual([3]);
  });

  it("counts unread messages in other channels only", async () => {
    apiMock.history.mockResolvedValue({ messages: [], hasMore: false, roomLastSeq: 0 });
    sock().hello();
    sock().push({ type: "room.subscribed", rooms: [{ roomId: ROOM, lastSeq: 0 }], denied: [] });
    await flush();
    ctl.setActiveRoom("other-room");
    sock().push({ type: "message.new", message: msg(1), committedAt: 0 });
    expect(store.getState().unread[ROOM]).toBe(1);
    ctl.setActiveRoom(ROOM);
    expect(store.getState().unread[ROOM]).toBe(0);
  });
});
