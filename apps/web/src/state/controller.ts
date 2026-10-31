import type { Me, Message, ServerEvent } from "@relay/shared";
import { api, ApiError, refreshSession } from "../lib/api";
import { newClientId } from "../lib/ids";
import { RelayConnection, type ConnectionOptions } from "../realtime/connection";
import { addTyping, clearTypingUser, TypingThrottle, typingKey } from "../realtime/typing";
import {
  addOptimistic,
  applyServerMessage,
  emptyIndex,
  markFailed,
  markPending,
  optimistic,
  pendingSends,
  removeMessage,
  type MessageIndex,
} from "./messages";
import { fromSnapshot, offline, online } from "./presence";
import { SeqTracker } from "./seqTracker";
import { initialChatState, initialLoad, toast, useChat, type ChatState } from "./store";

const GAP_GRACE_MS = 1200;
const RESEND_AFTER_MS = 8000;

export function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/ws`;
}

type Store = { getState: () => ChatState; setState: (p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void };

/**
 * Glue between the socket, the REST API and the store. Owns the delivery guarantees on the client:
 * optimistic sends with stable clientIds, idempotent resends, per-room seq tracking and gap fill.
 */
export class ChatController {
  readonly conn: RelayConnection;
  private trackers = new Map<string, SeqTracker>();
  /** Seqs seen before the room's tracker was initialised by room.subscribed. */
  private early = new Map<string, number[]>();
  private gapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private syncing = new Map<string, Promise<void>>();
  private lastAttempt = new Map<string, number>();
  private typingThrottle = new TypingThrottle();
  private resendTimer: ReturnType<typeof setInterval> | null = null;
  private cleanups: (() => void)[] = [];

  constructor(
    me: Me,
    private readonly hooks: { onSignedOut: () => void },
    connOpts: Partial<ConnectionOptions> = {},
    private readonly store: Store = useChat,
  ) {
    this.store.setState({ ...initialChatState(), me });
    this.conn = new RelayConnection({ ...connOpts, url: connOpts.url ?? defaultWsUrl() });
    this.cleanups.push(
      this.conn.on("status", (status, info) => this.store.setState({ conn: { status, nextRetryAt: info.nextRetryAt } })),
      this.conn.on("ready", () => this.onReady()),
      this.conn.on("event", (e) => this.onEvent(e)),
      this.conn.on("unauthorized", () => void this.onUnauthorized()),
    );
  }

  private get s() {
    return this.store.getState();
  }
  private set(p: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
    this.store.setState(p);
  }
  private idx(roomId: string): MessageIndex {
    return this.s.messages[roomId] ?? emptyIndex();
  }
  private setIdx(roomId: string, f: (i: MessageIndex) => MessageIndex) {
    this.set((s) => ({ messages: { ...s.messages, [roomId]: f(s.messages[roomId] ?? emptyIndex()) } }));
  }

  async start() {
    const online = () => this.conn.nudge();
    const offlineH = () => this.conn.markOffline();
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineH);
    this.cleanups.push(() => window.removeEventListener("online", online), () => window.removeEventListener("offline", offlineH));
    this.resendTimer = setInterval(() => this.resendStale(), 2000);
    await this.loadRooms();
    this.conn.connect();
  }

  stop(reason: "logout" | "leave" = "leave") {
    this.conn.stop(reason);
    for (const c of this.cleanups) c();
    this.cleanups = [];
    if (this.resendTimer) clearInterval(this.resendTimer);
    for (const t of this.gapTimers.values()) clearTimeout(t);
  }

  async loadRooms() {
    this.set({ roomsState: { ...this.s.roomsState, loading: true, error: null } });
    try {
      const { rooms } = await api.rooms();
      this.set({ rooms, roomsState: { loaded: true, loading: false, hasMore: false, error: null } });
    } catch (e) {
      this.set({ roomsState: { ...this.s.roomsState, loading: false, error: (e as Error).message } });
    }
  }

  private memberRoomIds() {
    return this.s.rooms.filter((r) => r.isMember).map((r) => r.id);
  }

  private onReady() {
    const ids = this.memberRoomIds();
    if (ids.length) this.conn.send({ type: "room.subscribe", roomIds: ids });
  }

  private async onUnauthorized() {
    if (await refreshSession()) this.conn.connect();
    else {
      this.stop("logout");
      this.hooks.onSignedOut();
    }
  }

  private onEvent(e: ServerEvent) {
    switch (e.type) {
      case "room.subscribed":
        for (const { roomId, lastSeq } of e.rooms) void this.onSubscribed(roomId, lastSeq);
        if (e.denied.length) this.set((s) => ({ rooms: s.rooms.map((r) => (e.denied.includes(r.id) ? { ...r, isMember: false } : r)) }));
        this.resendAll();
        return;
      case "message.new":
        this.onServerMessage(e.message, false);
        return;
      case "message.ack":
        this.lastAttempt.delete(e.clientId);
        this.onServerMessage(e.message, true);
        return;
      case "message.error": {
        this.lastAttempt.delete(e.clientId);
        const roomId = this.findRoomOfClientId(e.clientId);
        if (!roomId) return;
        if (e.code === "rate_limited") {
          setTimeout(() => this.retry(roomId, e.clientId), 1500);
          return;
        }
        this.setIdx(roomId, (i) => markFailed(i, e.clientId, e.message, e.retryable));
        return;
      }
      case "typing": {
        const key = typingKey(e.roomId, e.parentId);
        this.set((s) => ({ typing: addTyping(s.typing, key, e.user, Date.now()) }));
        return;
      }
      case "presence.snapshot":
        this.set({ presence: fromSnapshot(e.entries), serverOffset: e.serverTime - Date.now() });
        return;
      case "presence.update":
        this.set((s) => ({ presence: e.state === "online" ? online(s.presence, e.entry) : offline(s.presence, e.entry.user.id, e.entry.connId) }));
        return;
      case "resync":
        for (const id of e.roomIds ?? this.memberRoomIds()) void this.syncRoom(id);
        return;
      case "membership.revoked":
        if (e.userId === this.s.me?.id) {
          this.set((s) => ({ rooms: s.rooms.map((r) => (r.id === e.roomId ? { ...r, isMember: false } : r)) }));
          this.trackers.delete(e.roomId);
        }
        return;
      case "error":
        if (e.code === "server") toast(e.message, "error");
        return;
      case "pong":
        return;
    }
  }

  private findRoomOfClientId(clientId: string): string | null {
    for (const [roomId, idx] of Object.entries(this.s.messages)) if (idx.byKey[clientId]) return roomId;
    return null;
  }

  private onServerMessage(m: Message, own: boolean) {
    this.setIdx(m.roomId, (i) => applyServerMessage(i, m));
    const typingK = typingKey(m.roomId, m.parentId);
    this.set((s) => ({ typing: clearTypingUser(s.typing, typingK, m.author.id) }));
    if (!own && m.author.id !== this.s.me?.id && m.parentId === null && this.s.activeRoomId !== m.roomId) {
      this.set((s) => ({ unread: { ...s.unread, [m.roomId]: (s.unread[m.roomId] ?? 0) + 1 } }));
    }
    this.observeSeq(m.roomId, m.seq);
  }

  private observeSeq(roomId: string, seq: number) {
    const t = this.trackers.get(roomId);
    if (!t) {
      const list = this.early.get(roomId) ?? [];
      list.push(seq);
      this.early.set(roomId, list);
      return;
    }
    if (t.observe(seq)) this.scheduleGapFill(roomId);
  }

  private scheduleGapFill(roomId: string) {
    if (this.gapTimers.has(roomId)) return;
    // Events from different instances can arrive slightly out of order; wait briefly before fetching.
    this.gapTimers.set(
      roomId,
      setTimeout(() => {
        this.gapTimers.delete(roomId);
        if (this.trackers.get(roomId)?.hasGap()) void this.syncRoom(roomId);
      }, GAP_GRACE_MS),
    );
  }

  private async onSubscribed(roomId: string, lastSeq: number) {
    const t = this.trackers.get(roomId);
    if (t) {
      // Reconnect: fetch anything committed while we weren't listening.
      if (t.behind(lastSeq) || t.hasGap()) await this.syncRoom(roomId);
      return;
    }
    const tracker = new SeqTracker(lastSeq);
    this.trackers.set(roomId, tracker);
    for (const seq of this.early.get(roomId) ?? []) tracker.observe(seq);
    this.early.delete(roomId);
    if (tracker.hasGap()) this.scheduleGapFill(roomId);
    if (!this.s.history[roomId]?.loaded) await this.loadOlder(roomId);
  }

  /** Fetches every message after the tracker's cursor until caught up. Single-flight per room. */
  syncRoom(roomId: string): Promise<void> {
    const running = this.syncing.get(roomId);
    if (running) return running;
    const p = (async () => {
      const t = this.trackers.get(roomId);
      if (!t) return;
      try {
        for (let guard = 0; guard < 20; guard++) {
          const page = await api.after(roomId, t.value);
          for (const m of page.messages) this.onServerMessage(m, true);
          if (!page.hasMore) break;
        }
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 403)) this.scheduleGapFill(roomId);
      }
    })().finally(() => this.syncing.delete(roomId));
    this.syncing.set(roomId, p);
    return p;
  }

  async loadOlder(roomId: string) {
    const st = this.s.history[roomId] ?? initialLoad;
    if (st.loading || (st.loaded && !st.hasMore)) return;
    this.set((s) => ({ history: { ...s.history, [roomId]: { ...st, loading: true, error: null } } }));
    try {
      const confirmed = Object.values(this.idx(roomId).byKey).filter((m) => m.parentId === null && m.seq !== null);
      const oldest = st.loaded && confirmed.length ? Math.min(...confirmed.map((m) => m.seq!)) : undefined;
      const page = await api.history(roomId, oldest);
      this.setIdx(roomId, (i) => page.messages.reduce(applyServerMessage, i));
      this.set((s) => ({ history: { ...s.history, [roomId]: { loaded: true, loading: false, hasMore: page.hasMore, error: null } } }));
    } catch (e) {
      this.set((s) => ({ history: { ...s.history, [roomId]: { ...st, loading: false, error: (e as Error).message } } }));
    }
  }

  async openThread(parentId: string | null) {
    this.set({ openThreadId: parentId });
    if (parentId) await this.loadReplies(parentId);
  }

  async loadReplies(parentId: string) {
    const st = this.s.threads[parentId] ?? initialLoad;
    if (st.loading || (st.loaded && !st.hasMore)) return;
    this.set((s) => ({ threads: { ...s.threads, [parentId]: { ...st, loading: true, error: null } } }));
    try {
      let after = 0;
      for (const idx of Object.values(this.s.messages)) {
        for (const m of Object.values(idx.byKey)) if (m.parentId === parentId && m.seq && st.loaded) after = Math.max(after, m.seq);
      }
      const page = await api.replies(parentId, after);
      this.setIdx(page.parent.roomId, (i) => [page.parent, ...page.messages].reduce(applyServerMessage, i));
      this.set((s) => ({ threads: { ...s.threads, [parentId]: { loaded: true, loading: false, hasMore: page.hasMore, error: null } } }));
    } catch (e) {
      this.set((s) => ({ threads: { ...s.threads, [parentId]: { ...st, loading: false, error: (e as Error).message } } }));
    }
  }

  send(roomId: string, body: string, parentId: string | null = null): string | null {
    const me = this.s.me;
    const text = body.trim();
    if (!me || !text) return null;
    const clientId = newClientId();
    const author = { id: me.id, displayName: me.displayName, avatarColor: me.avatarColor };
    this.setIdx(roomId, (i) => addOptimistic(i, optimistic({ clientId, roomId, parentId, body: text, author })));
    this.typingThrottle.reset(typingKey(roomId, parentId));
    this.transmit(roomId, clientId);
    return clientId;
  }

  private transmit(roomId: string, clientId: string) {
    const m = this.idx(roomId).byKey[clientId];
    if (!m || m.status !== "pending") return;
    // Queued if the socket isn't open; resent with the same clientId when it is.
    if (this.conn.send({ type: "message.send", roomId, clientId, body: m.body, parentId: m.parentId })) this.lastAttempt.set(clientId, Date.now());
  }

  private resendAll() {
    for (const [roomId, idx] of Object.entries(this.s.messages)) for (const m of pendingSends(idx)) this.transmit(roomId, m.clientId);
  }

  private resendStale() {
    if (!this.conn.isOpen()) return;
    const now = Date.now();
    for (const [roomId, idx] of Object.entries(this.s.messages)) {
      for (const m of pendingSends(idx)) {
        const last = this.lastAttempt.get(m.clientId);
        if (last === undefined || now - last > RESEND_AFTER_MS) this.transmit(roomId, m.clientId);
      }
    }
  }

  retry(roomId: string, clientId: string) {
    this.setIdx(roomId, (i) => markPending(i, clientId));
    this.transmit(roomId, clientId);
  }

  discard(roomId: string, clientId: string) {
    this.setIdx(roomId, (i) => removeMessage(i, clientId));
  }

  typing(roomId: string, parentId: string | null) {
    if (!this.conn.isOpen()) return;
    if (this.typingThrottle.shouldSend(typingKey(roomId, parentId))) this.conn.send({ type: "typing", roomId, parentId });
  }

  setActiveRoom(roomId: string | null) {
    this.set((s) => ({ activeRoomId: roomId, openThreadId: roomId === s.activeRoomId ? s.openThreadId : null, unread: roomId ? { ...s.unread, [roomId]: 0 } : s.unread }));
  }

  async join(roomId: string) {
    await api.join(roomId);
    this.set((s) => ({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, isMember: true } : r)) }));
    this.conn.send({ type: "room.subscribe", roomIds: [roomId] });
  }

  async leave(roomId: string) {
    await api.leave(roomId);
    this.conn.send({ type: "room.unsubscribe", roomIds: [roomId] });
    this.trackers.delete(roomId);
    this.set((s) => {
      const messages = { ...s.messages };
      delete messages[roomId];
      const history = { ...s.history };
      delete history[roomId];
      return { rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, isMember: false } : r)), messages, history };
    });
  }
}
