CREATE TABLE "invitations" (
	"email" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE users SET status = 'active';--> statement-breakpoint
UPDATE users SET role = 'owner' WHERE id IN (SELECT user_id FROM memberships WHERE role = 'owner');--> statement-breakpoint
UPDATE users SET role = 'owner' WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1) AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('owner','member'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" in ('pending','active','rejected','blocked'));
