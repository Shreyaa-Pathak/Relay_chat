import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { REFRESH_TOKEN_TTL_S } from "./tokens.js";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.execute(sql`insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${hash(token)}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_S}))`);
  return token;
}

/**
 * Rotates a refresh token: the presented token is revoked and a new one is issued.
 * A revoked token presented again (possible theft) revokes every session of that user.
 */
export async function rotateSession(db: Db, token: string): Promise<{ userId: string; token: string } | null> {
  return db.transaction(async (tx) => {
    const found = rows<{ id: string; user_id: string; expired: boolean; revoked: boolean }>(
      await tx.execute(sql`select id, user_id, expires_at < now() as expired, revoked_at is not null as revoked
        from sessions where token_hash = ${hash(token)} for update`),
    );
    const s = found[0];
    if (!s) return null;
    if (s.revoked) {
      await tx.execute(sql`update sessions set revoked_at = now() where user_id = ${s.user_id} and revoked_at is null`);
      return null;
    }
    if (s.expired) return null;
    await tx.execute(sql`update sessions set revoked_at = now() where id = ${s.id}`);
    const next = randomBytes(32).toString("base64url");
    await tx.execute(sql`insert into sessions (user_id, token_hash, expires_at)
      values (${s.user_id}, ${hash(next)}, now() + make_interval(secs => ${REFRESH_TOKEN_TTL_S}))`);
    return { userId: s.user_id, token: next };
  });
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.execute(sql`update sessions set revoked_at = now() where token_hash = ${hash(token)} and revoked_at is null`);
}
