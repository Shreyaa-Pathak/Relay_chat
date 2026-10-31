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
}

export async function createUser(db: Db, input: { email: string; displayName: string; passwordHash: string }): Promise<Me> {
  // The brief reserves mint for brand/own messages; avatars are told apart with lavender and amber.
  const color = PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)]!;
  try {
    return await db.transaction(async (tx) => {
      const res = rows<UserRow>(
        await tx.execute(sql`insert into users (email, display_name, password_hash, avatar_color)
          values (${input.email}, ${input.displayName}, ${input.passwordHash}, ${color})
          returning id, email, display_name, avatar_color, password_hash`),
      );
      const u = res[0]!;
      await tx.execute(sql`insert into memberships (room_id, user_id) select id, ${u.id} from rooms where is_default on conflict do nothing`);
      return { ...toUserPublic(u), email: u.email };
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
    await db.execute(sql`select id, email, display_name, avatar_color, password_hash from users where lower(email) = lower(${email})`),
  );
  return res[0] ?? null;
}

export async function getMe(db: Db, id: string): Promise<Me | null> {
  const res = rows<UserRow>(await db.execute(sql`select id, email, display_name, avatar_color from users where id = ${id}`));
  return res[0] ? { ...toUserPublic(res[0]), email: res[0].email } : null;
}

export async function getUsersPublic(db: Db, ids: string[]): Promise<Map<string, UserPublic>> {
  if (ids.length === 0) return new Map();
  const res = rows<UserRow>(
    await db.execute(sql`select id, display_name, avatar_color from users where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
  );
  return new Map(res.map((r) => [r.id, toUserPublic(r)]));
}
