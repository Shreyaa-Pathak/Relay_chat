export interface PresenceRecord {
  userId: string;
  connId: string;
  expiresAt: number;
}

/**
 * One record per live connection (not per user), so one tab closing never hides a user whose
 * other tab is still connected. Records expire on their own if a connection dies abruptly.
 */
export interface PresenceStore {
  join(rec: PresenceRecord): Promise<void>;
  leave(userId: string, connId: string): Promise<void>;
  /** Unexpired records. */
  snapshot(now?: number): Promise<PresenceRecord[]>;
}
