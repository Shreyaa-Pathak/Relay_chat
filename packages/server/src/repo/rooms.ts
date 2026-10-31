import { sql } from "drizzle-orm";
import type { Room } from "@relay/shared";
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

interface RoomRow {
  id: string;
  community_id: string;
  slug: string;
  name: string;
  topic: string | null;
  is_private: boolean;
  last_seq: string;
  is_member: boolean;
  member_count: string;
}

/** Rooms the user can see: every public room plus private rooms they belong to. */
export async function listRooms(db: Db, userId: string, all = false, communityId?: string): Promise<Room[]> {
  const res = rows<RoomRow>(
    await db.execute(sql`
      select r.id, r.community_id, r.slug, r.name, r.topic, r.is_private, r.last_seq,
        exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId}) as is_member,
        (select count(*) from memberships m2 where m2.room_id = r.id) as member_count
      from rooms r join communities c on c.id = r.community_id
      join community_memberships cm on cm.community_id = c.id and cm.user_id = ${userId} and cm.status = 'active'
      where not c.is_suspended and (${communityId === undefined} or r.community_id = ${communityId ?? null})
      and (${all} or not r.is_private or exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId}))
      order by r.is_default desc, r.created_at asc, r.slug asc`),
  );
  return res.map((r) => ({
    id: r.id,
    communityId: r.community_id,
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
  const res = rows(await db.execute(sql`select 1 from memberships m join users u on u.id = m.user_id
    join rooms r on r.id = m.room_id join communities c on c.id = r.community_id
    join community_memberships cm on cm.community_id = c.id and cm.user_id = m.user_id
    where m.room_id = ${roomId} and m.user_id = ${userId} and u.status = 'active' and cm.status = 'active' and not c.is_suspended`));
  return res.length > 0;
}

/** Throws not_found if the room doesn't exist (or is private and invisible), forbidden if not a member. */
export async function assertMember(db: Db, roomId: string, userId: string): Promise<void> {
  const res = rows<{ is_private: boolean; member: boolean }>(
    await db.execute(sql`select r.is_private, exists(select 1 from memberships m where m.room_id = r.id and m.user_id = ${userId}) as member
      from rooms r join communities c on c.id = r.community_id
      join community_memberships cm on cm.community_id = c.id and cm.user_id = ${userId} and cm.status = 'active'
      where r.id = ${roomId} and not c.is_suspended`),
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
      join communities c on c.id = r.community_id join community_memberships cm on cm.community_id = c.id and cm.user_id = ${userId} and cm.status = 'active'
      where not c.is_suspended and exists(select 1 from users u where u.id = ${userId} and u.status = 'active') and r.id in (${sql.join(roomIds.map((id) => sql`${id}`), sql`, `)})`),
  );
  return new Map(res.map((r) => [r.id, Number(r.last_seq)]));
}

export async function roomLastSeq(db: Db, roomId: string): Promise<number> {
  const res = rows<{ last_seq: string }>(await db.execute(sql`select last_seq from rooms where id = ${roomId}`));
  return Number(res[0]?.last_seq ?? 0);
}

export async function joinRoom(db: Db, roomId: string, userId: string): Promise<void> {
  return db.transaction(async (tx) => {
    const active = await tx.execute(sql`select id from users where id = ${userId} and status = 'active' for share`);
    if (!active.rows.length) throw new AppError("forbidden", "Your account does not have access");
    const res = rows<{ is_private: boolean }>(await tx.execute(sql`select r.is_private from rooms r join communities c on c.id = r.community_id
      join community_memberships cm on cm.community_id = c.id and cm.user_id = ${userId} and cm.status = 'active'
      where r.id = ${roomId} and not c.is_suspended for share of c, cm, r`));
    if (!res[0]) throw new AppError("not_found", "Channel not found");
    if (res[0].is_private) throw new AppError("not_found", "Channel not found");
    await tx.execute(sql`insert into memberships (room_id, user_id) values (${roomId}, ${userId}) on conflict do nothing`);
  });
}

export async function leaveRoom(db: Db, roomId: string, userId: string): Promise<boolean> {
  const res = rows(await db.execute(sql`delete from memberships where room_id = ${roomId} and user_id = ${userId} returning 1`));
  return res.length > 0;
}
