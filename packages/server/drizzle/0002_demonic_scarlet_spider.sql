CREATE TABLE "seed_state" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO seed_state (key) SELECT 'default-channels' WHERE EXISTS (SELECT 1 FROM rooms WHERE is_default);
