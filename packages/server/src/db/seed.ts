import { sql } from "drizzle-orm";
import { DEFAULT_CHANNELS } from "@relay/shared";
import type { Db } from "./client.js";
import { communities, rooms, seedState } from "./schema.js";
import { DEFAULT_COMMUNITY_ID } from "../repo/communities.js";

/** Seed defaults once; later runs preserve the owner's channel deletions. */
export async function seedDefaultChannels(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.insert(communities).values({ id: DEFAULT_COMMUNITY_ID, slug: "relay", name: "Relay community", description: "Welcome to Relay", isDefault: true }).onConflictDoNothing();
    const claim = await tx.insert(seedState).values({ key: "default-channels" }).onConflictDoNothing().returning();
    if (!claim.length) return 0;
    const res = await tx
    .insert(rooms)
    .values(DEFAULT_CHANNELS.map((c) => ({ communityId: DEFAULT_COMMUNITY_ID, slug: c.slug, name: c.name, topic: c.topic, isDefault: true, isPrivate: false })))
    .onConflictDoNothing({ target: [rooms.communityId, rooms.slug] })
    .returning({ id: rooms.id });
    // Only active community members join default channels.
    await tx.execute(sql`
    insert into memberships (room_id, user_id)
    select r.id, cm.user_id from rooms r join community_memberships cm on cm.community_id = r.community_id
    join users u on u.id = cm.user_id where r.is_default and not r.is_private and cm.status = 'active' and u.status = 'active'
    on conflict do nothing`);
    return res.length;
  });
}
