import { z } from "zod";
import { clientId, Message, messageBody, UserPublic, uuid } from "./schemas.js";

/* ---------------- client -> server ---------------- */

export const MessageSendEvent = z.object({
  type: z.literal("message.send"),
  roomId: uuid,
  clientId,
  body: messageBody,
  parentId: uuid.nullable().optional(),
});

export const TypingSendEvent = z.object({
  type: z.literal("typing"),
  roomId: uuid,
  parentId: uuid.nullable().optional(),
});

export const RoomSubscribeEvent = z.object({
  type: z.literal("room.subscribe"),
  roomIds: z.array(uuid).min(1).max(200),
});

export const RoomUnsubscribeEvent = z.object({
  type: z.literal("room.unsubscribe"),
  roomIds: z.array(uuid).min(1).max(200),
});

export const PresenceSnapshotRequest = z.object({ type: z.literal("presence.request") });

/** Sent right before a client-initiated planned reconnect. */
export const ByeEvent = z.object({ type: z.literal("bye"), reason: z.enum(["reconnect", "logout", "leave"]) });

export const PingEvent = z.object({ type: z.literal("ping"), t: z.number() });

export const ClientEvent = z.discriminatedUnion("type", [
  MessageSendEvent,
  TypingSendEvent,
  RoomSubscribeEvent,
  RoomUnsubscribeEvent,
  PresenceSnapshotRequest,
  ByeEvent,
  PingEvent,
]);
export type ClientEvent = z.infer<typeof ClientEvent>;
export type MessageSendEvent = z.infer<typeof MessageSendEvent>;

/* ---------------- server -> client ---------------- */

export const HelloEvent = z.object({
  type: z.literal("hello"),
  protocol: z.number(),
  connId: z.string(),
  user: UserPublic,
  /** Server closes the socket after this many ms; client should reconnect earlier. */
  maxConnectionMs: z.number().int().positive(),
  serverTime: z.number(),
});

export const RoomSubscribedEvent = z.object({
  type: z.literal("room.subscribed"),
  rooms: z.array(z.object({ roomId: uuid, lastSeq: z.number().int().nonnegative() })),
  denied: z.array(uuid),
});

export const MessageAckEvent = z.object({
  type: z.literal("message.ack"),
  clientId,
  message: Message,
  /** true when this clientId was already committed (idempotent retry). */
  duplicate: z.boolean(),
});

export const MessageNewEvent = z.object({
  type: z.literal("message.new"),
  message: Message,
  /** Server time when the message committed (ms since epoch), for latency metrics. */
  committedAt: z.number(),
});

export const MessageErrorEvent = z.object({
  type: z.literal("message.error"),
  clientId: z.string(),
  code: z.enum(["validation", "forbidden", "not_found", "rate_limited", "conflict", "server"]),
  message: z.string(),
  retryable: z.boolean(),
});

export const TypingEvent = z.object({
  type: z.literal("typing"),
  roomId: uuid,
  parentId: uuid.nullable(),
  user: UserPublic,
  at: z.number(),
});

export const PresenceEntry = z.object({
  user: UserPublic,
  connId: z.string(),
  expiresAt: z.number(),
});
export type PresenceEntry = z.infer<typeof PresenceEntry>;

export const PresenceUpdateEvent = z.object({
  type: z.literal("presence.update"),
  state: z.enum(["online", "offline"]),
  entry: PresenceEntry,
});

export const PresenceSnapshotEvent = z.object({
  type: z.literal("presence.snapshot"),
  entries: z.array(PresenceEntry),
  serverTime: z.number(),
});

/** Ask clients to gap-fill (e.g. after the server's Redis subscription recovered). */
export const ResyncEvent = z.object({
  type: z.literal("resync"),
  reason: z.string(),
  roomIds: z.array(uuid).optional(),
});

/** A user lost access to a room (they left, or were removed). */
export const MembershipRevokedEvent = z.object({
  type: z.literal("membership.revoked"),
  roomId: uuid,
  userId: uuid,
});

export const ProtocolErrorEvent = z.object({
  type: z.literal("error"),
  code: z.enum(["bad_json", "bad_event", "rate_limited", "forbidden", "server"]),
  message: z.string(),
});

export const PongEvent = z.object({ type: z.literal("pong"), t: z.number(), serverTime: z.number() });

export const ServerEvent = z.discriminatedUnion("type", [
  HelloEvent,
  RoomSubscribedEvent,
  MessageAckEvent,
  MessageNewEvent,
  MessageErrorEvent,
  TypingEvent,
  PresenceUpdateEvent,
  PresenceSnapshotEvent,
  ResyncEvent,
  MembershipRevokedEvent,
  ProtocolErrorEvent,
  PongEvent,
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
export type HelloEvent = z.infer<typeof HelloEvent>;
export type MessageNewEvent = z.infer<typeof MessageNewEvent>;
export type MessageAckEvent = z.infer<typeof MessageAckEvent>;
export type MessageErrorEvent = z.infer<typeof MessageErrorEvent>;
export type TypingEvent = z.infer<typeof TypingEvent>;
export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEvent>;
export type PresenceSnapshotEvent = z.infer<typeof PresenceSnapshotEvent>;

/** Events that travel through the Bus between instances. */
export const BusEvent = z.discriminatedUnion("type", [
  MessageNewEvent,
  TypingEvent,
  PresenceUpdateEvent,
  MembershipRevokedEvent,
]);
export type BusEvent = z.infer<typeof BusEvent>;

export const topics = {
  room: (roomId: string) => `room:${roomId}`,
  presence: "presence",
} as const;
