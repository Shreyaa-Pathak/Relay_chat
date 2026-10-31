import type { AvatarColor, Message, UserPublic } from "@relay/shared";

export interface MessageRow {
  id: string;
  room_id: string;
  parent_id: string | null;
  seq: string | number;
  body: string;
  client_id: string;
  reply_count: number;
  created_at: Date | string;
  author_id: string;
  author_name: string;
  author_color: string;
  parent_reply_count?: number | null;
}

export const MESSAGE_COLUMNS = `
  m.id, m.room_id, m.parent_id, m.seq, m.body, m.client_id, m.reply_count, m.created_at,
  u.id as author_id, u.display_name as author_name, u.avatar_color as author_color`;

export function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    roomId: r.room_id,
    parentId: r.parent_id,
    seq: Number(r.seq),
    body: r.body,
    clientId: r.client_id,
    replyCount: r.reply_count,
    createdAt: new Date(r.created_at).toISOString(),
    author: { id: r.author_id, displayName: r.author_name, avatarColor: r.author_color as AvatarColor },
    parentReplyCount: r.parent_reply_count ?? null,
  };
}

export function toUserPublic(r: { id: string; display_name?: string; displayName?: string; avatar_color?: string; avatarColor?: string }): UserPublic {
  return {
    id: r.id,
    displayName: (r.display_name ?? r.displayName) as string,
    avatarColor: (r.avatar_color ?? r.avatarColor) as AvatarColor,
  };
}
