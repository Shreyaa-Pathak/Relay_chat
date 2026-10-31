import { describe, expect, it } from "vitest";
import { ClientEvent, ServerEvent, RegisterInput, LIMITS } from "./index.js";

const room = "7f6b2c1e-1d2a-4e3b-9c4d-5e6f7a8b9c0d";

describe("ClientEvent", () => {
  it("accepts a valid message.send and trims the body", () => {
    const r = ClientEvent.parse({ type: "message.send", roomId: room, clientId: "abc12345-x", body: "  hi \r\n" });
    expect(r).toMatchObject({ type: "message.send", body: "hi" });
  });
  it("rejects empty and oversized bodies", () => {
    expect(ClientEvent.safeParse({ type: "message.send", roomId: room, clientId: "abc12345", body: "   " }).success).toBe(false);
    expect(
      ClientEvent.safeParse({ type: "message.send", roomId: room, clientId: "abc12345", body: "x".repeat(LIMITS.messageBodyMax + 1) }).success,
    ).toBe(false);
  });
  it("rejects bad room ids, bad client ids and unknown types", () => {
    expect(ClientEvent.safeParse({ type: "message.send", roomId: "nope", clientId: "abc12345", body: "a" }).success).toBe(false);
    expect(ClientEvent.safeParse({ type: "message.send", roomId: room, clientId: "has space!", body: "a" }).success).toBe(false);
    expect(ClientEvent.safeParse({ type: "message.delete", roomId: room }).success).toBe(false);
  });
  it("accepts thread replies and typing", () => {
    expect(ClientEvent.safeParse({ type: "message.send", roomId: room, clientId: "abc12345", body: "a", parentId: room }).success).toBe(true);
    expect(ClientEvent.safeParse({ type: "typing", roomId: room }).success).toBe(true);
  });
});

describe("ServerEvent", () => {
  it("parses message.new", () => {
    const ev = {
      type: "message.new",
      committedAt: 1,
      message: {
        id: room, roomId: room, parentId: null, seq: 1, body: "hi", clientId: "abc12345",
        createdAt: new Date().toISOString(), replyCount: 0,
        author: { id: room, displayName: "Ada", avatarColor: "lavender" },
      },
    };
    expect(ServerEvent.parse(ev).type).toBe("message.new");
  });
});

describe("RegisterInput", () => {
  it("normalises email and enforces password length", () => {
    expect(RegisterInput.parse({ email: " Ada@Example.COM ", password: "x".repeat(10), displayName: "Ada" }).email).toBe("ada@example.com");
    expect(RegisterInput.safeParse({ email: "a@b.co", password: "short", displayName: "Ada" }).success).toBe(false);
    expect(RegisterInput.safeParse({ email: "a@b.co", password: "x".repeat(10), displayName: "<script>" }).success).toBe(false);
  });
});
