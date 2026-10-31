import { createDb, createPool } from "./client.js";
import { runMigrations } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in, or export it in your shell.");
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  await runMigrations(createDb(pool));
  console.log("Migrations applied.");
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
