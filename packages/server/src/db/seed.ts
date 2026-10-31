import { sql } from "drizzle-orm";
import { DEFAULT_CHANNELS } from "@relay/shared";
import type { Db } from "./client.js";
import { rooms } from "./schema.js";

/** Idempotent: inserts the four default channels if missing, never touches existing rows. */
export async function seedDefaultChannels(db: Db): Promise<number> {
  const res = await db
    .insert(rooms)
    .values(DEFAULT_CHANNELS.map((c) => ({ slug: c.slug, name: c.name, topic: c.topic, isDefault: true, isPrivate: false })))
    .onConflictDoNothing({ target: rooms.slug })
    .returning({ id: rooms.id });
  // Every existing user is a member of every default channel.
  await db.execute(sql`
    insert into memberships (room_id, user_id)
    select r.id, u.id from rooms r cross join users u where r.is_default
    on conflict do nothing`);
  return res.length;
}
