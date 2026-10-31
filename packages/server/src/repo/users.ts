import { sql } from "drizzle-orm";
import { type Me, type UserPublic } from "@relay/shared";

const PROFILE_COLORS = ["lavender", "amber"] as const;
import type { Db } from "../db/client.js";
import { AppError } from "../errors.js";
import { toUserPublic } from "./mappers.js";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_color: string;
  password_hash: string;
  role: Me["role"];
  status: Me["status"];
}

export async function createUser(db: Db, input: { email: string; displayName: string; passwordHash: string }): Promise<Me> {
  // The brief reserves mint for brand/own messages; avatars are told apart with lavender and amber.
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)]!;
  try {
    return await db.transaction(async (tx) => {
      // Serialize first-superadmin assignment across concurrent signups.
      await tx.execute(sql`select pg_advisory_xact_lock(7263541)`);
      const res = rows<UserRow>(
        await tx.execute(sql`insert into users (email, display_name, password_hash, avatar_color, role, status)
          values (${input.email}, ${input.displayName}, ${input.passwordHash}, ${color},
            case when not exists(select 1 from users) then 'superadmin' else 'member' end, 'active')
          returning id, email, display_name, avatar_color, password_hash, role, status`),
      );
      const u = res[0]!;
      await tx.execute(sql`insert into community_memberships (community_id, user_id, role)
        select id, ${u.id}, case when ${u.role} = 'superadmin' then 'owner' else 'member' end from communities where is_default and not is_private and not is_suspended on conflict do nothing`);
      await tx.execute(sql`insert into memberships (room_id, user_id) select r.id, ${u.id} from rooms r
        join community_memberships cm on cm.community_id = r.community_id and cm.user_id = ${u.id} and cm.status = 'active'
        where r.is_default and not r.is_private on conflict do nothing`);
      return { ...toUserPublic(u), email: u.email, role: u.role, status: u.status };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505" || (err as { cause?: { code?: string } }).cause?.code === "23505") {
      throw new AppError("conflict", "An account with this email already exists");
    }
    throw err;
  }
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const res = rows<UserRow>(
    await db.execute(sql`select id, email, display_name, avatar_color, password_hash, role, status from users where lower(email) = lower(${email})`),
  );
  return res[0] ?? null;
}

export async function getMe(db: Db, id: string): Promise<Me | null> {
  const res = rows<UserRow>(await db.execute(sql`select id, email, display_name, avatar_color, role, status from users where id = ${id}`));
  return res[0] ? { ...toUserPublic(res[0]), email: res[0].email, role: res[0].role, status: res[0].status } : null;
}

export async function getUsersPublic(db: Db, ids: string[]): Promise<Map<string, UserPublic>> {
  if (ids.length === 0) return new Map();
  const res = rows<UserRow>(
    await db.execute(sql`select id, display_name, avatar_color from users where status = 'active' and id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
  );
  return new Map(res.map((r) => [r.id, toUserPublic(r)]));
}
