import type { ServerEvent } from "@relay/shared";
import type { SocketLike } from "../realtime/connection";

export class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  closedWith: number | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(ev: ServerEvent) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  hello(maxConnectionMs = 290_000) {
    this.open();
    this.push({ type: "hello", protocol: 1, connId: "c" + FakeSocket.all.indexOf(this), user: { id: ME.id, displayName: "Me", avatarColor: "green" }, maxConnectionMs, serverTime: Date.now() });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  sentOfType(type: string) {
    return this.sent.filter((e) => (e as { type: string }).type === type) as Record<string, unknown>[];
  }
}

export const ME = { id: "00000000-0000-4000-8000-000000000001", email: "me@x.io", displayName: "Me", avatarColor: "green" as const };
export const OTHER = { id: "00000000-0000-4000-8000-000000000002", displayName: "Bo", avatarColor: "amber" as const };
export const ROOM = "10000000-0000-4000-8000-000000000001";

let n = 0;
export function msg(seq: number, over: Partial<{ clientId: string; parentId: string | null; author: typeof OTHER; body: string; replyCount: number; parentReplyCount: number | null; id: string }> = {}) {
  n++;
  return {
    id: over.id ?? `20000000-0000-4000-8000-${String(seq).padStart(6, "0")}${String(n).padStart(6, "0")}`.slice(0, 36),
    roomId: ROOM,
    parentId: over.parentId ?? null,
    seq,
    body: over.body ?? `m${seq}`,
    clientId: over.clientId ?? `client-${seq}-${n}`,
    createdAt: new Date(2026, 0, 1, 0, 0, 100 - seq).toISOString(), // clocks deliberately backwards
    replyCount: over.replyCount ?? 0,
    author: over.author ?? OTHER,
    parentReplyCount: over.parentReplyCount ?? null,
  };
}
