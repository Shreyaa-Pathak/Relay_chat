CREATE TABLE "communities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_suspended" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "communities_slug_format" CHECK ("communities"."slug" ~ '^[a-z0-9][a-z0-9-]{0,39}$')
);
--> statement-breakpoint
CREATE TABLE "community_memberships" (
	"community_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "community_memberships_community_id_user_id_pk" PRIMARY KEY("community_id","user_id"),
	CONSTRAINT "community_memberships_role_check" CHECK ("community_memberships"."role" in ('owner','member')),
	CONSTRAINT "community_memberships_status_check" CHECK ("community_memberships"."status" in ('active','blocked'))
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
DROP INDEX "rooms_slug_key";--> statement-breakpoint
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_pkey";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
INSERT INTO communities (id, slug, name, description, is_default) VALUES ('00000000-0000-4000-8000-000000000001', 'relay', 'Relay community', 'Welcome to Relay', true);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "community_id" uuid;--> statement-breakpoint
UPDATE rooms SET community_id = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE invitations SET community_id = '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
ALTER TABLE rooms ALTER COLUMN community_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE invitations ALTER COLUMN community_id SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_community_id_email_pk" PRIMARY KEY("community_id","email");--> statement-breakpoint
INSERT INTO community_memberships (community_id, user_id, role, status)
SELECT '00000000-0000-4000-8000-000000000001', id, CASE WHEN role = 'owner' THEN 'owner' ELSE 'member' END,
CASE WHEN status IN ('blocked','rejected') THEN 'blocked' ELSE 'active' END FROM users;--> statement-breakpoint
UPDATE users SET role = 'superadmin' WHERE id = (SELECT id FROM users ORDER BY (role = 'owner') DESC, created_at, id LIMIT 1);--> statement-breakpoint
UPDATE users SET role = 'member' WHERE role = 'owner';--> statement-breakpoint
UPDATE users SET status = 'active' WHERE status IN ('pending','rejected','blocked');--> statement-breakpoint
INSERT INTO memberships (room_id, user_id)
SELECT r.id, cm.user_id FROM rooms r JOIN community_memberships cm ON cm.community_id = r.community_id
JOIN users u ON u.id = cm.user_id WHERE r.is_default AND NOT r.is_private AND cm.status = 'active' AND u.status = 'active'
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communities_slug_key" ON "communities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "community_memberships_user_idx" ON "community_memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_community_slug_key" ON "rooms" USING btree ("community_id","slug");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('superadmin','owner','member'));
