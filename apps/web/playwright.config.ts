import { defineConfig, devices } from "@playwright/test";

/**
 * Local E2E: real Relay server (packages/server/dist) + `vite preview` of the built app, against
 * local Postgres and Redis. Requires `pnpm build` first and DATABASE_URL/REDIS_URL reachable.
 */
const DB = process.env.E2E_DATABASE_URL ?? "postgres://relay:relay@localhost:5432/relay_e2e";
const REDIS = process.env.E2E_REDIS_URL ?? "redis://localhost:6379";
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: [
    {
      command: "node ../../packages/server/dist/dev.js",
      url: "http://localhost:3001/api/v1/health",
      reuseExistingServer: false,
      env: {
        DATABASE_URL: DB,
        REDIS_URL: REDIS,
        AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e",
        APP_URL: `http://localhost:${PORT}`,
        PORT: "3001",
        LOG_LEVEL: "warn",
        REGISTER_LIMIT_PER_HOUR: "1000",
        NODE_ENV: "test",
      },
    },
    { command: `pnpm exec vite preview --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false },
  ],
});
