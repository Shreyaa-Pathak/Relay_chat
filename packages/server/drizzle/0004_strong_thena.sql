ALTER TABLE "invitations" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");