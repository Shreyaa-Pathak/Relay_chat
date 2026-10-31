import type pg from "pg";
import { createDb, createPool, type Db } from "./db/client.js";
import type { Env } from "./env.js";
import { createLogger, type Logger } from "./log.js";
import { Metrics } from "./metrics.js";
import type { Bus } from "./bus/types.js";
import { MemoryBus } from "./bus/memory.js";
import { RedisBus } from "./bus/redis.js";
import type { PresenceStore } from "./presence/types.js";
import { MemoryPresence } from "./presence/memory.js";
import { RedisPresence } from "./presence/redis.js";

export interface Relay {
  env: Env;
  log: Logger;
  pool: pg.Pool;
  db: Db;
  bus: Bus;
  presence: PresenceStore;
  metrics: Metrics;
  close(): Promise<void>;
}

export interface RelayOverrides {
  bus?: Bus;
  presence?: PresenceStore;
  log?: Logger;
}

export function createRelay(env: Env, overrides: RelayOverrides = {}): Relay {
  const log = overrides.log ?? createLogger(env.LOG_LEVEL, { svc: "relay" });
  const pool = createPool(env.DATABASE_URL, env.DB_POOL_MAX);
  pool.on("error", (err) => log.warn("pg pool error", { err: err.message }));
  const db = createDb(pool);

  let bus: Bus;
  let presence: PresenceStore;
  if (overrides.bus) bus = overrides.bus;
  else if (env.REDIS_URL) bus = new RedisBus(env.REDIS_URL, log);
  else {
    log.warn("using in-memory bus (RELAY_ALLOW_MEMORY_BUS=1): messages will not cross processes");
    bus = new MemoryBus();
  }
  if (overrides.presence) presence = overrides.presence;
  else if (bus instanceof RedisBus) presence = new RedisPresence(bus.commands);
  else presence = new MemoryPresence();

  return {
    env,
    log,
    pool,
    db,
    bus,
    presence,
    metrics: new Metrics(),
    async close() {
      await bus.close();
      await pool.end();
    },
  };
}
