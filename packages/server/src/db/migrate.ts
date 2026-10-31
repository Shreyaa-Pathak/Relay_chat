import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

/** Migrations ship next to the package (packages/server/drizzle). */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/db or dist/db -> package root
  return path.resolve(here, "../../drizzle");
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
