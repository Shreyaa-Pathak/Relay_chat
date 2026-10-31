import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration files share one database; run files sequentially.
    fileParallelism: false,
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" } },
      {
        test: {
          name: "integration",
          include: ["test/**/*.test.ts"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: { BCRYPT_COST: "4" },
        },
      },
    ],
  },
});
