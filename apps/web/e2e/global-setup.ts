import { execSync } from "node:child_process";

export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://relay:relay@localhost:5432/relay_e2e";
  const env = { ...process.env, DATABASE_URL: url };
  execSync("pnpm --filter @relay/server run db:migrate", { stdio: "inherit", env, cwd: "../.." });
  execSync(`psql "${url}" -q -c "truncate messages, memberships, sessions, users restart identity cascade"`, { stdio: "inherit" });
  execSync("pnpm --filter @relay/server run db:seed", { stdio: "inherit", env, cwd: "../.." });
}
