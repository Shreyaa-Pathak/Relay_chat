import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadEnv } from "./env.js";
import { startServer } from "./server.js";

/** Minimal .env loader (repo root .env), so local dev doesn't need another dependency. */
function loadDotEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, k, v] = m;
    if (process.env[k!] === undefined) process.env[k!] = v!.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();
let env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error("\nRelay server is not configured. Fix these in .env (see .env.example):\n");
    for (const i of err.issues) console.error(`  • ${i.variable}: ${i.message}`);
    console.error("");
    process.exit(1);
  }
  throw err;
}
const port = Number(process.env.PORT ?? 3001);
const running = await startServer(env, { port, host: "0.0.0.0" });
running.relay.log.info("relay dev server listening", { api: `${running.url}/api/v1`, ws: running.wsUrl });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, async () => {
    running.relay.log.info("shutting down", { sig });
    await running.close();
    process.exit(0);
  });
}
