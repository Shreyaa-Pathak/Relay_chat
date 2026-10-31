import { sql } from "drizzle-orm";
import type { AdminMember, CreateRoomInput, Me } from "@relay/shared";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";
import { getMe } from "./users.js";
import { assertCommunityMember } from "./communities.js";

export async function assertActive(db: Db, userId: string) {
  const user = await getMe(db, userId);
  if (!user) throw new AppError("unauthorized", "Account not found");
  if (user.status !== "active") throw new AppError("forbidden", `Your account is ${user.status}`);
  return user;
}

export async function assertSuperadmin(db: Db, userId: string) {
  const user = await assertActive(db, userId);
  if (user.role !== "superadmin") throw new AppError("forbidden", "Only the superadmin can manage communities");
}

export async function assertOwner(db: Db, userId: string, communityId: string) {
  await assertActive(db, userId);
  const role = await assertCommunityMember(db, communityId, userId);
  if (role !== "owner") throw new AppError("forbidden", "Only this community's owner can manage it");
}

export async function listMembers(db: Db, communityId: string): Promise<AdminMember[]> {
  const result = await db.execute(sql`select u.id, u.email, u.display_name as "displayName", u.avatar_color as "avatarColor", cm.role, cm.status,
    coalesce((select json_agg(m.room_id) from memberships m join rooms r on r.id = m.room_id where m.user_id = u.id and r.community_id = ${communityId}), '[]'::json) as "roomIds"
    from users u join community_memberships cm on cm.user_id = u.id where cm.community_id = ${communityId} order by u.created_at, u.id`);
  return result.rows as AdminMember[];
}

export async function setMemberStatus(db: Db, communityId: string, userId: string, status: Me["status"]) {
  if (status !== "active" && status !== "blocked") throw new AppError("validation", "Choose active or blocked; public membership does not require approval");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from communities where id = ${communityId} for update`);
    const changed = await tx.execute(sql`update community_memberships set status = ${status} where community_id = ${communityId} and user_id = ${userId} and role <> 'owner' returning user_id`);
    if (!changed.rows.length) throw new AppError("forbidden", "Owners cannot be moderated, or this member does not exist in this community");
    if (status === "active") {
      await tx.execute(sql`insert into memberships (room_id, user_id) select id, ${userId} from rooms where community_id = ${communityId} and is_default and not is_private on conflict do nothing`);
      return [] as string[];
    }
    const removed = await tx.execute(sql`delete from memberships m using rooms r where m.room_id = r.id and r.community_id = ${communityId} and m.user_id = ${userId} returning m.room_id`);
    return (removed.rows as { room_id: string }[]).map((r) => r.room_id);
  });
}

export async function inviteMember(db: Db, communityId: string, email: string) {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7263541)`);
    await tx.execute(sql`select id from communities where id = ${communityId} for update`);
    const existing = await tx.execute(sql`select id, status from users where lower(email) = ${email}`);
    const user = existing.rows[0] as { id: string; status: string } | undefined;
    if (user) {
      if (user.status !== "active") throw new AppError("conflict", "This account is suspended");
      const membership = await tx.execute(sql`select status from community_memberships where community_id = ${communityId} and user_id = ${user.id}`);
      if (membership.rows.length) throw new AppError("conflict", "This person already belongs to this community. Restore blocked members from the members list.");
    }
    await tx.execute(sql`insert into invitations (community_id, email, token_hash) values (${communityId}, ${email}, ${hash})
      on conflict (community_id, email) do update set token_hash = ${hash}, created_at = now(), expires_at = now() + interval '7 days'`);
  });
  return token;
}

export async function acceptInvitation(db: Db, userId: string, token: string) {
  const hash = createHash("sha256").update(token).digest("hex");
  return db.transaction(async (tx) => {
    const candidate = await tx.execute(sql`select community_id from invitations where token_hash = ${hash}`);
    if (!candidate.rows.length) throw new AppError("not_found", "This invitation is invalid, expired or already used");
    const communityId = (candidate.rows[0] as { community_id: string }).community_id;
    const community = await tx.execute(sql`select id, slug from communities where id = ${communityId} and not is_suspended for update`);
    if (!community.rows.length) throw new AppError("not_found", "This community is unavailable");
    const invitation = await tx.execute(sql`select email from invitations where community_id = ${communityId} and token_hash = ${hash} and expires_at > now() for update`);
    if (!invitation.rows.length) throw new AppError("not_found", "This invitation is invalid, expired or already used");
    const user = await tx.execute(sql`select email from users where id = ${userId} and status = 'active' for share`);
    if ((user.rows[0] as { email: string } | undefined)?.email.toLowerCase() !== (invitation.rows[0] as { email: string }).email) {
      throw new AppError("forbidden", "Sign in with the email address this invitation was created for");
    }
    const member = await tx.execute(sql`select status from community_memberships where community_id = ${communityId} and user_id = ${userId}`);
    if ((member.rows[0] as { status: string } | undefined)?.status === "blocked") throw new AppError("forbidden", "The owner must restore your community access first");
    await tx.execute(sql`insert into community_memberships (community_id, user_id) values (${communityId}, ${userId}) on conflict do nothing`);
    await tx.execute(sql`insert into memberships (room_id, user_id) select id, ${userId} from rooms where community_id = ${communityId} and is_default and not is_private on conflict do nothing`);
    await tx.execute(sql`delete from invitations where community_id = ${communityId} and token_hash = ${hash}`);
    return community.rows[0] as { id: string; slug: string };
  });
}

export async function createRoom(db: Db, communityId: string, userId: string, input: CreateRoomInput) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select id from communities where id = ${communityId} for share`);
      const result = await tx.execute(sql`insert into rooms (community_id, slug, name, topic, is_private) values (${communityId}, ${input.slug}, ${input.name}, ${input.topic || null}, ${input.isPrivate}) returning id`);
      const id = (result.rows[0] as { id: string }).id;
      await tx.execute(sql`insert into memberships (room_id, user_id, role) values (${id}, ${userId}, 'owner')`);
      return id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") throw new AppError("conflict", "A channel with this slug already exists in this community");
    throw err;
  }
}

export async function deleteRoom(db: Db, communityId: string, roomId: string) {
  return db.transaction(async (tx) => {
    // Match the community-first lock order used by sends and member moderation.
    await tx.execute(sql`select id from communities where id = ${communityId} for update`);
    const room = await tx.execute(sql`select id from rooms where id = ${roomId} and community_id = ${communityId} for update`);
    if (!room.rows.length) throw new AppError("not_found", "Channel not found");
    const members = await tx.execute(sql`select user_id from memberships where room_id = ${roomId}`);
    await tx.execute(sql`delete from rooms where id = ${roomId}`);
    return (members.rows as { user_id: string }[]).map((m) => m.user_id);
  });
}

export async function setChannelMember(db: Db, communityId: string, roomId: string, userId: string, add: boolean) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from communities where id = ${communityId} for update`);
    await assertCommunityMember(tx as Db, communityId, userId);
    const room = await tx.execute(sql`select id from rooms where id = ${roomId} and community_id = ${communityId} for share`);
    if (!room.rows.length) throw new AppError("not_found", "Channel not found");
    if (add) await tx.execute(sql`insert into memberships (room_id, user_id) values (${roomId}, ${userId}) on conflict do nothing`);
    else await tx.execute(sql`delete from memberships where room_id = ${roomId} and user_id = ${userId}`);
  });
}
