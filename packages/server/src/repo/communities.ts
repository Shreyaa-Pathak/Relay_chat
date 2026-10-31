import { sql } from "drizzle-orm";
import type { Community, CreateCommunityInput } from "@relay/shared";
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";

export const DEFAULT_COMMUNITY_ID = "00000000-0000-4000-8000-000000000001";

export async function listCommunities(db: Db, userId: string, all = false): Promise<Community[]> {
  const result = await db.execute(sql`select c.id, c.slug, c.name, c.description, c.is_private as "isPrivate", c.is_suspended as "isSuspended",
    coalesce(cm.status = 'active', false) as "isMember", case when cm.status = 'active' then cm.role else null end as role,
    (select count(*)::int from community_memberships m where m.community_id = c.id and m.status = 'active') as "memberCount"
    from communities c left join community_memberships cm on cm.community_id = c.id and cm.user_id = ${userId}
    where ${all} or (not c.is_suspended and (cm.status = 'active' or (not c.is_private and cm.user_id is null)))
    order by c.is_default desc, c.created_at, c.id`);
  return result.rows as Community[];
}

export async function assertCommunityMember(db: Db, communityId: string, userId: string) {
  const result = await db.execute(sql`select cm.role from community_memberships cm join communities c on c.id = cm.community_id
    join users u on u.id = cm.user_id where cm.community_id = ${communityId} and cm.user_id = ${userId}
    and cm.status = 'active' and u.status = 'active' and not c.is_suspended`);
  if (!result.rows.length) throw new AppError("not_found", "Community not found or access unavailable");
  return (result.rows[0] as { role: "owner" | "member" }).role;
}

export async function joinCommunity(db: Db, communityId: string, userId: string) {
  await db.transaction(async (tx) => {
    const community = await tx.execute(sql`select is_private, is_suspended from communities where id = ${communityId} for share`);
    const c = community.rows[0] as { is_private: boolean; is_suspended: boolean } | undefined;
    if (!c || c.is_suspended) throw new AppError("not_found", "Community not found");
    const membership = await tx.execute(sql`select status from community_memberships where community_id = ${communityId} and user_id = ${userId} for update`);
    const m = membership.rows[0] as { status: string } | undefined;
    if (m?.status === "blocked") throw new AppError("forbidden", "You are blocked from this community");
    if (c.is_private && !m) throw new AppError("not_found", "This community requires an invitation");
    await tx.execute(sql`insert into community_memberships (community_id, user_id) values (${communityId}, ${userId}) on conflict do nothing`);
    await tx.execute(sql`insert into memberships (room_id, user_id) select id, ${userId} from rooms where community_id = ${communityId} and is_default and not is_private on conflict do nothing`);
  });
}

export async function createCommunity(db: Db, input: CreateCommunityInput) {
  try {
    return await db.transaction(async (tx) => {
      const owner = await tx.execute(sql`select id from users where lower(email) = ${input.ownerEmail} and status = 'active' for share`);
      if (!owner.rows.length) throw new AppError("validation", "The owner must have an active Relay account first");
      const ownerId = (owner.rows[0] as { id: string }).id;
      const created = await tx.execute(sql`insert into communities (slug, name, description, is_private) values (${input.slug}, ${input.name}, ${input.description}, ${input.isPrivate}) returning id`);
      const id = (created.rows[0] as { id: string }).id;
      await tx.execute(sql`insert into community_memberships (community_id, user_id, role) values (${id}, ${ownerId}, 'owner')`);
      const room = await tx.execute(sql`insert into rooms (community_id, slug, name, is_default) values (${id}, 'general', 'general', true) returning id`);
      await tx.execute(sql`insert into memberships (room_id, user_id, role) values (${(room.rows[0] as { id: string }).id}, ${ownerId}, 'owner')`);
      return id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") throw new AppError("conflict", "A community with this slug already exists");
    throw err;
  }
}

export async function updateCommunity(db: Db, id: string, input: { isSuspended?: boolean; ownerEmail?: string }) {
  await db.transaction(async (tx) => {
    const found = await tx.execute(sql`select id from communities where id = ${id} for update`);
    if (!found.rows.length) throw new AppError("not_found", "Community not found");
    if (input.isSuspended !== undefined) await tx.execute(sql`update communities set is_suspended = ${input.isSuspended} where id = ${id}`);
    if (input.ownerEmail) {
      const owner = await tx.execute(sql`select id from users where lower(email) = ${input.ownerEmail} and status = 'active'`);
      if (!owner.rows.length) throw new AppError("validation", "The owner must have an active Relay account first");
      const userId = (owner.rows[0] as { id: string }).id;
      await tx.execute(sql`update community_memberships set role = 'member' where community_id = ${id} and role = 'owner'`);
      await tx.execute(sql`insert into community_memberships (community_id, user_id, role) values (${id}, ${userId}, 'owner')
        on conflict (community_id, user_id) do update set role = 'owner', status = 'active'`);
      await tx.execute(sql`insert into memberships (room_id, user_id) select id, ${userId} from rooms where community_id = ${id} and is_default and not is_private on conflict do nothing`);
    }
  });
}

/** Presence is visible only among active members of the requested community. */
export async function communityUserIds(db: Db, communityId: string): Promise<Set<string>> {
  const result = await db.execute(sql`select cm.user_id from community_memberships cm join communities c on c.id = cm.community_id
    join users u on u.id = cm.user_id where cm.community_id = ${communityId} and cm.status = 'active' and u.status = 'active' and not c.is_suspended`);
  return new Set((result.rows as { user_id: string }[]).map((r) => r.user_id));
}
