import { z } from "zod";
import { AVATAR_COLORS, LIMITS } from "./constants.js";

export const uuid = z.string().uuid();
/** Client-generated idempotency key (a UUID in practice). */
export const clientId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const messageBody = z
  .string()
  .transform((s) => s.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().min(1, "Message is empty").max(LIMITS.messageBodyMax, `Messages are limited to ${LIMITS.messageBodyMax} characters`));

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters`)
  .max(LIMITS.passwordMax);
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a display name")
  .max(LIMITS.displayNameMax)
  .regex(/^[^<>]+$/, "Display names can't contain < or >");

export const RegisterInput = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const UserPublic = z.object({
  id: uuid,
  displayName: z.string(),
  avatarColor: z.enum(AVATAR_COLORS),
});
export type UserPublic = z.infer<typeof UserPublic>;

export const Me = UserPublic.extend({ email: z.string() });
export type Me = z.infer<typeof Me>;

export const Room = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  topic: z.string().nullable(),
  isPrivate: z.boolean(),
  isMember: z.boolean(),
  lastSeq: z.number().int().nonnegative(),
  memberCount: z.number().int().nonnegative(),
});
export type Room = z.infer<typeof Room>;

/** An authoritative, committed message. */
export const Message = z.object({
  id: uuid,
  roomId: uuid,
  parentId: uuid.nullable(),
  seq: z.number().int().positive(),
  body: z.string(),
  clientId: z.string(),
  createdAt: z.string(),
  replyCount: z.number().int().nonnegative(),
  author: UserPublic,
  /** For replies: the parent's reply count right after this reply committed. */
  parentReplyCount: z.number().int().nonnegative().nullable().optional(),
});
export type Message = z.infer<typeof Message>;

export const HistoryQuery = z
  .object({
    beforeSeq: z.coerce.number().int().positive().optional(),
    afterSeq: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(LIMITS.syncPageMax).optional(),
  })
  .refine((q) => !(q.beforeSeq !== undefined && q.afterSeq !== undefined), {
    message: "Use beforeSeq or afterSeq, not both",
  });

export const HistoryPage = z.object({
  messages: z.array(Message),
  /** Room's last committed seq when the page was read. */
  roomLastSeq: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type HistoryPage = z.infer<typeof HistoryPage>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;
