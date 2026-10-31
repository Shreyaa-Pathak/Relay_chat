import { sql } from "drizzle-orm";
import type { Message } from "@relay/shared";
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";
import { MESSAGE_COLUMNS, toMessage, type MessageRow } from "./mappers.js";

export interface SendInput {
  userId: string;
  roomId: string;
  clientId: string;
  body: string;
  parentId?: string | null;
}

export interface SendResult {
  message: Message;
  duplicate: boolean;
}

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

/**
 * Commits one message with a stable per-room sequence number.
 *
 * Concurrency: the room row is locked (SELECT ... FOR UPDATE) before the idempotency check and
 * the seq increment, so concurrent sends to a room serialize on that row. Any failure rolls the
 * whole transaction back, including the counter, so committed seqs are gap-free per room.
 */
export async function sendMessage(db: Db, input: SendInput): Promise<SendResult> {
  return db.transaction(async (tx) => {
    // Moderation locks this same user row, so a blocked account cannot race a send.
    const active = await tx.execute(sql`select id from users where id = ${input.userId} and status = 'active' for share`);
    if (!active.rows.length) throw new AppError("forbidden", "Your account does not have access");
    const community = await tx.execute(sql`select c.id from communities c join rooms r on r.community_id = c.id
      join community_memberships cm on cm.community_id = c.id and cm.user_id = ${input.userId}
      where r.id = ${input.roomId} and cm.status = 'active' and not c.is_suspended for share of c, cm`);
    if (!community.rows.length) throw new AppError("not_found", "Channel not found or access unavailable");
    const member = rows<{ ok: number }>(
      await tx.execute(sql`select 1 as ok from memberships where room_id = ${input.roomId} and user_id = ${input.userId} for share`),
    );
    if (member.length === 0) {
      const exists = rows(await tx.execute(sql`select 1 from rooms where id = ${input.roomId}`));
      throw exists.length ? new AppError("forbidden", "You are not a member of this channel") : new AppError("not_found", "Channel not found");
    }

    const locked = rows<{ last_seq: string }>(await tx.execute(sql`select last_seq from rooms where id = ${input.roomId} for update`));
    if (!locked[0]) throw new AppError("not_found", "Channel not found");

    // Idempotency: same sender + client_id returns the original committed message.
    const existing = rows<MessageRow>(
      await tx.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)}, p.reply_count as parent_reply_count
        from messages m join users u on u.id = m.author_id left join messages p on p.id = m.parent_id
        where m.author_id = ${input.userId} and m.client_id = ${input.clientId}`),
    );
    if (existing[0]) {
      if (existing[0].room_id !== input.roomId) throw new AppError("conflict", "clientId was already used in another channel");
      return { message: toMessage(existing[0]), duplicate: true };
    }

    if (input.parentId) {
      const parent = rows<{ room_id: string; parent_id: string | null }>(
        await tx.execute(sql`select room_id, parent_id from messages where id = ${input.parentId}`),
      );
      if (!parent[0] || parent[0].room_id !== input.roomId) throw new AppError("not_found", "The message you're replying to isn't in this channel");
      if (parent[0].parent_id) throw new AppError("validation", "Replies can't have their own threads");
    }

    const seq = Number(locked[0].last_seq) + 1;
    await tx.execute(sql`update rooms set last_seq = ${seq} where id = ${input.roomId}`);

    const inserted = rows<{ id: string }>(
      await tx.execute(sql`insert into messages (room_id, author_id, parent_id, seq, body, client_id)
        values (${input.roomId}, ${input.userId}, ${input.parentId ?? null}, ${seq}, ${input.body}, ${input.clientId})
        returning id`),
    );
    let parentReplyCount: number | null = null;
    if (input.parentId) {
      const upd = rows<{ reply_count: number }>(
        await tx.execute(sql`update messages set reply_count = reply_count + 1 where id = ${input.parentId} returning reply_count`),
      );
      parentReplyCount = upd[0]?.reply_count ?? null;
    }
    const full = rows<MessageRow>(
      await tx.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)} from messages m join users u on u.id = m.author_id where m.id = ${inserted[0]!.id}`),
    );
    return { message: { ...toMessage(full[0]!), parentReplyCount }, duplicate: false };
  });
}

/** Top-level channel history, newest page first, returned in ascending seq order. */
export async function channelHistory(db: Db, roomId: string, opts: { beforeSeq?: number; limit: number }) {
  const before = opts.beforeSeq ?? Number.MAX_SAFE_INTEGER;
  const res = rows<MessageRow>(
    await db.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)} from messages m join users u on u.id = m.author_id
      where m.room_id = ${roomId} and m.parent_id is null and m.seq < ${before}
      order by m.seq desc limit ${opts.limit + 1}`),
  );
  const hasMore = res.length > opts.limit;
  return { messages: res.slice(0, opts.limit).reverse().map(toMessage), hasMore };
}

/** Every committed message (top-level and replies) after a seq, ascending. Used for gap fill. */
export async function messagesAfter(db: Db, roomId: string, afterSeq: number, limit: number) {
  const res = rows<MessageRow>(
    await db.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)}, p.reply_count as parent_reply_count
      from messages m join users u on u.id = m.author_id left join messages p on p.id = m.parent_id
      where m.room_id = ${roomId} and m.seq > ${afterSeq}
      order by m.seq asc limit ${limit + 1}`),
  );
  const hasMore = res.length > limit;
  return { messages: res.slice(0, limit).map(toMessage), hasMore };
}

export async function getMessage(db: Db, id: string): Promise<Message | null> {
  const res = rows<MessageRow>(
    await db.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)} from messages m join users u on u.id = m.author_id where m.id = ${id}`),
  );
  return res[0] ? toMessage(res[0]) : null;
}

/** Replies in a thread, ascending, paginated by seq. */
export async function threadReplies(db: Db, parentId: string, opts: { afterSeq?: number; limit: number }) {
  const res = rows<MessageRow>(
    await db.execute(sql`select ${sql.raw(MESSAGE_COLUMNS)} from messages m join users u on u.id = m.author_id
      where m.parent_id = ${parentId} and m.seq > ${opts.afterSeq ?? 0}
      order by m.seq asc limit ${opts.limit + 1}`),
  );
  const hasMore = res.length > opts.limit;
  return { messages: res.slice(0, opts.limit).map(toMessage), hasMore };
}
