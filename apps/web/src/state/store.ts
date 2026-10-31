import { create } from "zustand";
import type { Me, Room } from "@relay/shared";
import type { ConnectionStatus } from "../realtime/connection";
import type { TypingState } from "../realtime/typing";
import type { MessageIndex } from "./messages";
import type { PresenceState } from "./presence";

export interface LoadState {
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  error: string | null;
}

export interface Toast {
  id: number;
  tone: "info" | "error" | "success";
  text: string;
}

export interface ChatState {
  me: Me | null;
  rooms: Room[];
  roomsState: LoadState;
  messages: Record<string, MessageIndex>;
  history: Record<string, LoadState>;
  threads: Record<string, LoadState>;
  presence: PresenceState;
  /** serverTime - Date.now() at the last snapshot. */
  serverOffset: number;
  typing: TypingState;
  unread: Record<string, number>;
  activeRoomId: string | null;
  openThreadId: string | null;
  conn: { status: ConnectionStatus; nextRetryAt: number | null };
  toasts: Toast[];
}

export const initialLoad: LoadState = { loaded: false, loading: false, hasMore: true, error: null };

export const initialChatState = (): ChatState => ({
  me: null,
  rooms: [],
  roomsState: { ...initialLoad },
  messages: {},
  history: {},
  threads: {},
  presence: {},
  serverOffset: 0,
  typing: {},
  unread: {},
  activeRoomId: null,
  openThreadId: null,
  conn: { status: "idle", nextRetryAt: null },
  toasts: [],
});

export const useChat = create<ChatState>(() => initialChatState());

let toastId = 0;
export function toast(text: string, tone: Toast["tone"] = "info", ttlMs = 5000) {
  const id = ++toastId;
  useChat.setState((s) => ({ toasts: [...s.toasts, { id, tone, text }] }));
  setTimeout(() => dismissToast(id), ttlMs);
}
export function dismissToast(id: number) {
  useChat.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
