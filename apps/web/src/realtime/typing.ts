import type { UserPublic } from "@relay/shared";
import { LIMITS } from "@relay/shared";

/** Sender side: at most one typing event per key per interval. */
export class TypingThrottle {
  private last = new Map<string, number>();
  constructor(private readonly intervalMs = LIMITS.typingThrottleMs) {}
  shouldSend(key: string, now = Date.now()): boolean {
    const prev = this.last.get(key) ?? -Infinity;
    if (now - prev < this.intervalMs) return false;
    this.last.set(key, now);
    return true;
  }
  /** After sending a message, the next keystroke should announce typing again. */
  reset(key: string) {
    this.last.delete(key);
  }
}

export type TypingState = Record<string, Record<string, { user: UserPublic; at: number }>>;

export const typingKey = (roomId: string, parentId: string | null) => `${roomId}|${parentId ?? ""}`;

export function addTyping(s: TypingState, key: string, user: UserPublic, at: number): TypingState {
  return { ...s, [key]: { ...(s[key] ?? {}), [user.id]: { user, at } } };
}

export function clearTypingUser(s: TypingState, key: string, userId: string): TypingState {
  if (!s[key]?.[userId]) return s;
  const inner = { ...s[key] };
  delete inner[userId];
  return { ...s, [key]: inner };
}

/** Users still typing (refreshed within the expiry window). */
export function activeTypers(s: TypingState, key: string, now = Date.now(), expireMs = LIMITS.typingExpireMs): UserPublic[] {
  return Object.values(s[key] ?? {})
    .filter((t) => now - t.at < expireMs)
    .map((t) => t.user);
}

export function typingLabel(users: UserPublic[]): string {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0]!.displayName} is typing…`;
  if (users.length === 2) return `${users[0]!.displayName} and ${users[1]!.displayName} are typing…`;
  return `${users.length} people are typing…`;
}
