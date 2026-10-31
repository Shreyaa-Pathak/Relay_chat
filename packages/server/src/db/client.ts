import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export function createPool(url: string, max: number): pg.Pool {
  const needsTls = /sslmode=require|neon\.tech/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max,
    // Serverless instances are short-lived; don't hold idle connections for long.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(needsTls && !/sslmode=/.test(url) ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}
