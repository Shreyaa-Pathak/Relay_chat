import { execSync } from "node:child_process";
import { createDb, createPool } from "../../../packages/server/src/db/client.js";
import { createUser } from "../../../packages/server/src/repo/users.js";
import { hashPassword } from "../../../packages/server/src/auth/password.js";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://relay:relay@localhost:5432/relay_e2e";
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm --filter @relay/server run db:migrate", { stdio: "inherit", env, cwd: "../.." });
  execSync(`psql "${url}" -q -c "truncate messages, memberships, sessions, users, rooms, invitations, seed_state, communities, community_memberships restart identity cascade"`, { stdio: "inherit" });
  execSync("pnpm --filter @relay/server run db:seed", { stdio: "inherit", env, cwd: "../.." });
  const pool = createPool(url, 1);
  try {
    await createUser(createDb(pool), { email: "superadmin@relay.test", displayName: "Superadmin", passwordHash: await hashPassword("correct horse battery") });
  } finally { await pool.end(); }
}
