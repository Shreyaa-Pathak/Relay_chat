import type { Redis } from "ioredis";
import type { PresenceRecord, PresenceStore } from "./types.js";

/**
 * Sorted set `relay:presence`: member "<userId>|<connId>", score = expiresAt (ms).
 * join = 1 ZADD (+ an occasional ZREMRANGEBYSCORE cleanup), leave = 1 ZREM, snapshot = 1 ZRANGEBYSCORE.
 */
export class RedisPresence implements PresenceStore {
  constructor(
    private readonly redis: Redis,
    private readonly key = "relay:presence",
    private readonly cleanupEvery = 10,
  ) {}
  private joins = 0;

  async join(rec: PresenceRecord) {
    await this.redis.zadd(this.key, rec.expiresAt, `${rec.userId}|${rec.connId}`);
    if (++this.joins % this.cleanupEvery === 0) await this.redis.zremrangebyscore(this.key, "-inf", Date.now());
  }
  async leave(userId: string, connId: string) {
    await this.redis.zrem(this.key, `${userId}|${connId}`);
  }
  async snapshot(now = Date.now()) {
    const flat = await this.redis.zrangebyscore(this.key, `(${now}`, "+inf", "WITHSCORES");
    const out: PresenceRecord[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const [userId, connId] = flat[i]!.split("|");
      if (userId && connId) out.push({ userId, connId, expiresAt: Number(flat[i + 1]) });
    }
    return out;
  }
}
