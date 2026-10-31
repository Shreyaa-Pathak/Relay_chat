import { createDb, createPool } from "./client.js";
import { seedDefaultChannels } from "./seed.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const pool = createPool(url, 1);
try {
  const n = await seedDefaultChannels(createDb(pool));
  console.log(`Seed complete (${n} new channel(s)).`);
} catch (err) {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
