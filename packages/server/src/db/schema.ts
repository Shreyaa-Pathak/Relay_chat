import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    avatarColor: text("avatar_color").notNull().default("lavender"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_key").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in ('superadmin','owner','member')`),
    check("users_status_check", sql`${t.status} in ('pending','active','rejected','blocked')`),
    check("users_avatar_color_check", sql`${t.avatarColor} in ('lavender','amber','green','blush')`),
    check("users_display_name_len", sql`char_length(${t.displayName}) between 1 and 40`),
  ],
);

export const communities = pgTable("communities", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isPrivate: boolean("is_private").notNull().default(false),
  isSuspended: boolean("is_suspended").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("communities_slug_key").on(t.slug), check("communities_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`)]);

export const communityMemberships = pgTable("community_memberships", {
  communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("active"),
}, (t) => [primaryKey({ columns: [t.communityId, t.userId] }), index("community_memberships_user_idx").on(t.userId),
  check("community_memberships_role_check", sql`${t.role} in ('owner','member')`),
  check("community_memberships_status_check", sql`${t.status} in ('active','blocked')`)]);

export const invitations = pgTable("invitations", {
  email: text("email").notNull(),
  communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '7 days'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.communityId, t.email] }), uniqueIndex("invitations_token_hash_key").on(t.tokenHash)]);

export const seedState = pgTable("seed_state", { key: text("key").primaryKey() });

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the refresh token; the raw token only lives in an httpOnly cookie. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_hash_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull().references(() => communities.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    topic: text("topic"),
    isPrivate: boolean("is_private").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    /** Per-room sequence counter. Incremented under a row lock in the send transaction. */
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rooms_community_slug_key").on(t.communityId, t.slug),
    check("rooms_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`),
    check("rooms_last_seq_nonneg", sql`${t.lastSeq} >= 0`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_check", sql`${t.role} in ('member','owner')`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => messages.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    body: text("body").notNull(),
    clientId: text("client_id").notNull(),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One stable seq per committed message in a room; also the history index. */
    uniqueIndex("messages_room_seq_key").on(t.roomId, t.seq),
    /** Idempotency: a sender's retry with the same client_id never creates a second row. */
    uniqueIndex("messages_author_client_key").on(t.authorId, t.clientId),
    /** Channel timeline paging (top-level messages only). */
    index("messages_room_top_seq_idx").on(t.roomId, t.seq).where(sql`${t.parentId} is null`),
    /** Thread paging. */
    index("messages_parent_seq_idx").on(t.parentId, t.seq),
    check("messages_body_len", sql`char_length(${t.body}) between 1 and 4000`),
    check("messages_seq_pos", sql`${t.seq} > 0`),
    check("messages_reply_count_nonneg", sql`${t.replyCount} >= 0`),
  ],
);
