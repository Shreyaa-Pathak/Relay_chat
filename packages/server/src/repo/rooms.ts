import { sql } from "drizzle-orm";
import type { Room } from "@relay/shared";
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

interface RoomRow {
  id: string;
  slug: string;
  name: string;
  topic: string | null;
  is_private: boolean;
  last_seq: string;
  is_member: boolean;
  member_count: string;
}

/** Rooms the user can see: every public room plus private rooms they belong to. */
export async function listRooms(db: Db, userId: string): Promise<Room[]> {
  const res = rows<RoomRow>(
    await db.execute(sql`
      select r.id, r.slug, r.name, r.topic, r.is_private, r.last_seq,
        exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId}) as is_member,
        (select count(*) from memberships m2 where m2.room_id = r.id) as member_count
      from rooms r
      where not r.is_private or exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId})
      order by r.is_default desc, r.created_at asc, r.slug asc`),
  );
  return res.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    topic: r.topic,
    isPrivate: r.is_private,
    isMember: r.is_member,
    lastSeq: Number(r.last_seq),
    memberCount: Number(r.member_count),
  }));
}

export async function isMember(db: Db, roomId: string, userId: string): Promise<boolean> {
  const res = rows(await db.execute(sql`select 1 from memberships where room_id = ${roomId} and user_id = ${userId}`));
  return res.length > 0;
}

/** Throws not_found if the room doesn't exist (or is private and invisible), forbidden if not a member. */
export async function assertMember(db: Db, roomId: string, userId: string): Promise<void> {
  const res = rows<{ is_private: boolean; member: boolean }>(
    await db.execute(sql`select r.is_private, exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId}) as member
      from rooms r where r.id = ${roomId}`),
  );
  const r = res[0];
  if (!r || (r.is_private && !r.member)) throw new AppError("not_found", "Channel not found");
  if (!r.member) throw new AppError("forbidden", "Join this channel to read it");
}

/** Of the given room ids, which the user is a member of, with their current last_seq. */
export async function memberRoomSeqs(db: Db, userId: string, roomIds: string[]): Promise<Map<string, number>> {
  if (roomIds.length === 0) return new Map();
  const res = rows<{ id: string; last_seq: string }>(
    await db.execute(sql`select r.id, r.last_seq from rooms r join memberships m on m.room_id = r.id and m.user_id = ${userId}
      where r.id in (${sql.join(roomIds.map((id) => sql`${id}`), sql`, `)})`),
  );
  return new Map(res.map((r) => [r.id, Number(r.last_seq)]));
}

export async function roomLastSeq(db: Db, roomId: string): Promise<number> {
  const res = rows<{ last_seq: string }>(await db.execute(sql`select last_seq from rooms where id = ${roomId}`));
  return Number(res[0]?.last_seq ?? 0);
}

export async function joinRoom(db: Db, roomId: string, userId: string): Promise<void> {
  const res = rows<{ is_private: boolean }>(await db.execute(sql`select is_private from rooms where id = ${roomId}`));
  if (!res[0]) throw new AppError("not_found", "Channel not found");
  if (res[0].is_private) throw new AppError("not_found", "Channel not found");
  await db.execute(sql`insert into memberships (room_id, user_id) values (${roomId}, ${userId}) on conflict do nothing`);
}

export async function leaveRoom(db: Db, roomId: string, userId: string): Promise<boolean> {
  const res = rows(await db.execute(sql`delete from memberships where room_id = ${roomId} and user_id = ${userId} returning 1`));
  return res.length > 0;
}
