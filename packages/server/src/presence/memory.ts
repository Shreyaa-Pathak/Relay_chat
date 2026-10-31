import type { PresenceRecord, PresenceStore } from "./types.js";

export class MemoryPresence implements PresenceStore {
  private recs = new Map<string, PresenceRecord>();
  async join(rec: PresenceRecord) {
    this.recs.set(`${rec.userId}|${rec.connId}`, rec);
  }
  async leave(userId: string, connId: string) {
    this.recs.delete(`${userId}|${connId}`);
  }
  async snapshot(now = Date.now()) {
    const out: PresenceRecord[] = [];
    for (const [k, r] of this.recs) {
      if (r.expiresAt > now) out.push(r);
      else this.recs.delete(k);
    }
    return out;
  }
}
