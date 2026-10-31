import type { PresenceEntry, UserPublic } from "@relay/shared";

/** userId -> { user, conns: connId -> expiresAt (server clock) } */
export type PresenceState = Record<string, { user: UserPublic; conns: Record<string, number> }>;

export function fromSnapshot(entries: PresenceEntry[]): PresenceState {
  let s: PresenceState = {};
  for (const e of entries) s = online(s, e);
  return s;
}

export function online(s: PresenceState, e: PresenceEntry): PresenceState {
  const cur = s[e.user.id];
  return { ...s, [e.user.id]: { user: e.user, conns: { ...(cur?.conns ?? {}), [e.connId]: e.expiresAt } } };
}

export function offline(s: PresenceState, userId: string, connId: string): PresenceState {
  const cur = s[userId];
  if (!cur || !(connId in cur.conns)) return s;
  const conns = { ...cur.conns };
  delete conns[connId];
  return { ...s, [userId]: { ...cur, conns } };
}

/** A user is online while any of their connections is unexpired. `serverNow` = local time + server offset. */
export function onlineUsers(s: PresenceState, serverNow: number): UserPublic[] {
  return Object.values(s)
    .filter((p) => Object.values(p.conns).some((exp) => exp > serverNow))
    .map((p) => p.user)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
