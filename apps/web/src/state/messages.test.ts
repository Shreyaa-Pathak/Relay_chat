import { describe, expect, it } from "vitest";
import { addOptimistic, applyServerMessage, emptyIndex, markFailed, markPending, optimistic, pendingSends, thread, timeline } from "./messages";
import { ME, msg, OTHER, ROOM } from "../test/fakeSocket";

const me = { id: ME.id, displayName: "Me", avatarColor: "green" as const };

describe("optimistic reconciliation", () => {
  it("replaces the optimistic message in place when the ack arrives", () => {
    let i = addOptimistic(emptyIndex(), optimistic({ clientId: "abc12345", roomId: ROOM, parentId: null, body: "hi", author: me }));
    expect(timeline(i)[0]).toMatchObject({ status: "pending", seq: null });
    i = applyServerMessage(i, { ...msg(7, { clientId: "abc12345", author: me as never, body: "hi" }) });
    const tl = timeline(i);
    expect(tl).toHaveLength(1);
    expect(tl[0]).toMatchObject({ key: "abc12345", status: "sent", seq: 7 });
  });

  it("is idempotent for duplicate deliveries (ack + broadcast + gap fill)", () => {
    const m = msg(3);
    let i = applyServerMessage(emptyIndex(), m);
    i = applyServerMessage(i, m);
    i = applyServerMessage(i, m);
    expect(timeline(i)).toHaveLength(1);
  });

  it("orders by server seq, never by client clocks, with unsent messages last", () => {
    let i = emptyIndex();
    for (const s of [5, 2, 9, 1]) i = applyServerMessage(i, msg(s));
    i = addOptimistic(i, optimistic({ clientId: "local-1x", roomId: ROOM, parentId: null, body: "x", author: me, now: new Date(2000, 0, 1) }));
    expect(timeline(i).map((m) => m.seq)).toEqual([1, 2, 5, 9, null]);
  });

  it("marks failures and retries keep the same clientId", () => {
    let i = addOptimistic(emptyIndex(), optimistic({ clientId: "abc12345", roomId: ROOM, parentId: null, body: "hi", author: me }));
    i = markFailed(i, "abc12345", "nope", true);
    expect(i.byKey.abc12345).toMatchObject({ status: "failed", error: "nope", retryable: true });
    i = markPending(i, "abc12345");
    expect(pendingSends(i).map((m) => m.clientId)).toEqual(["abc12345"]);
    // A late failure never downgrades a delivered message.
    i = applyServerMessage(i, msg(1, { clientId: "abc12345", author: me as never }));
    expect(markFailed(i, "abc12345", "late", false).byKey.abc12345!.status).toBe("sent");
  });

  it("keeps replies out of the timeline and bumps the parent's reply count", () => {
    const parent = msg(1);
    let i = applyServerMessage(emptyIndex(), parent);
    i = applyServerMessage(i, msg(2, { parentId: parent.id, parentReplyCount: 1 }));
    i = applyServerMessage(i, msg(3, { parentId: parent.id, parentReplyCount: 2 }));
    // An older copy of the parent (e.g. from history) can't lower the count.
    i = applyServerMessage(i, { ...parent, replyCount: 0 });
    expect(timeline(i).map((m) => m.seq)).toEqual([1]);
    expect(timeline(i)[0]!.replyCount).toBe(2);
    expect(thread(i, parent.id).map((m) => m.seq)).toEqual([2, 3]);
    void OTHER;
  });
});
