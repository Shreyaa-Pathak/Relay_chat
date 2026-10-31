import type { Message, UserPublic } from "@relay/shared";

export type DeliveryStatus = "pending" | "sent" | "failed";

/** A message as the UI sees it: either authoritative (has id + seq) or optimistic. */
export interface ClientMessage {
  /** Stable key for rendering and reconciliation: the sender's clientId. */
  key: string;
  clientId: string;
  id: string | null;
  seq: number | null;
  roomId: string;
  parentId: string | null;
  body: string;
  author: UserPublic;
  createdAt: string;
  replyCount: number;
  status: DeliveryStatus;
  error?: string;
  retryable?: boolean;
}

export interface MessageIndex {
  byKey: Record<string, ClientMessage>;
  /** server id -> key */
  idToKey: Record<string, string>;
}

export const emptyIndex = (): MessageIndex => ({ byKey: {}, idToKey: {} });

export function optimistic(input: { clientId: string; roomId: string; parentId: string | null; body: string; author: UserPublic; now?: Date }): ClientMessage {
  return {
    key: input.clientId,
    clientId: input.clientId,
    id: null,
    seq: null,
    roomId: input.roomId,
    parentId: input.parentId,
    body: input.body,
    author: input.author,
    createdAt: (input.now ?? new Date()).toISOString(),
    replyCount: 0,
    status: "pending",
  };
}

/** Adds or replaces with the authoritative version. Idempotent; safe for duplicates and out-of-order delivery. */
export function applyServerMessage(idx: MessageIndex, m: Message): MessageIndex {
  const existing = idx.byKey[m.clientId];
  const next: ClientMessage = {
    key: m.clientId,
    clientId: m.clientId,
    id: m.id,
    seq: m.seq,
    roomId: m.roomId,
    parentId: m.parentId,
    body: m.body,
    author: m.author,
    createdAt: m.createdAt,
    // Reply counts only grow; keep the larger of what we know and what this copy says.
    replyCount: Math.max(existing?.replyCount ?? 0, m.replyCount),
    status: "sent",
  };
  const byKey = { ...idx.byKey, [next.key]: next };
  const idToKey = idx.idToKey[m.id] ? idx.idToKey : { ...idx.idToKey, [m.id]: next.key };
  if (m.parentId && m.parentReplyCount != null) {
    const parentKey = idToKey[m.parentId];
    const parent = parentKey ? byKey[parentKey] : undefined;
    if (parent && parent.replyCount < m.parentReplyCount) byKey[parentKey!] = { ...parent, replyCount: m.parentReplyCount };
  }
  return { byKey, idToKey };
}

export function addOptimistic(idx: MessageIndex, m: ClientMessage): MessageIndex {
  if (idx.byKey[m.key]?.status === "sent") return idx;
  return { ...idx, byKey: { ...idx.byKey, [m.key]: m } };
}

export function markFailed(idx: MessageIndex, clientId: string, error: string, retryable: boolean): MessageIndex {
  const m = idx.byKey[clientId];
  if (!m || m.status === "sent") return idx;
  return { ...idx, byKey: { ...idx.byKey, [clientId]: { ...m, status: "failed", error, retryable } } };
}

export function markPending(idx: MessageIndex, clientId: string): MessageIndex {
  const m = idx.byKey[clientId];
  if (!m || m.status === "sent") return idx;
  const { error: _e, retryable: _r, ...rest } = m;
  return { ...idx, byKey: { ...idx.byKey, [clientId]: { ...rest, status: "pending" } } };
}

export function removeMessage(idx: MessageIndex, clientId: string): MessageIndex {
  if (!idx.byKey[clientId] || idx.byKey[clientId]!.status === "sent") return idx;
  const byKey = { ...idx.byKey };
  delete byKey[clientId];
  return { ...idx, byKey };
}

/** Confirmed messages by seq (never by client clock), then unconfirmed ones in send order. */
export function ordered(list: ClientMessage[]): ClientMessage[] {
  const confirmed = list.filter((m) => m.seq !== null).sort((a, b) => a.seq! - b.seq!);
  const local = list.filter((m) => m.seq === null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...confirmed, ...local];
}

export function timeline(idx: MessageIndex): ClientMessage[] {
  return ordered(Object.values(idx.byKey).filter((m) => m.parentId === null));
}

export function thread(idx: MessageIndex, parentId: string): ClientMessage[] {
  return ordered(Object.values(idx.byKey).filter((m) => m.parentId === parentId));
}

export function pendingSends(idx: MessageIndex): ClientMessage[] {
  return ordered(Object.values(idx.byKey).filter((m) => m.status === "pending"));
}

export function byId(idx: MessageIndex, id: string): ClientMessage | undefined {
  const k = idx.idToKey[id];
  return k ? idx.byKey[k] : undefined;
}
