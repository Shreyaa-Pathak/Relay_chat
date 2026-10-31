import http from "node:http";
import { ConfigError, loadEnv } from "./env.js";
import { createRelay, type Relay } from "./context.js";
import { createApi } from "./http/app.js";
import { Gateway } from "./ws/gateway.js";

/**
 * Vercel Function entry points. One Relay context per function instance (Fluid compute reuses
 * instances across requests); nothing durable lives in it — Postgres and Redis hold all state.
 */
let relay: Relay | null = null;
let gateway: Gateway | null = null;
let api: ReturnType<typeof createApi> | null = null;

async function attachPool(r: Relay) {
  // Lets Vercel close idle pool clients before an instance is suspended (Fluid compute).
  try {
    const mod = (await import("@vercel/functions")) as { attachDatabasePool?: (pool: unknown) => void };
    mod.attachDatabasePool?.(r.pool);
  } catch {
    /* not on Vercel */
  }
}

function getRelay(): Relay {
  if (!relay) {
    relay = createRelay(loadEnv());
    void attachPool(relay);
    relay.log.info("relay instance started", { region: process.env.VERCEL_REGION });
  }
  return relay;
}

function configErrorBody(err: ConfigError) {
  return JSON.stringify({ error: { code: "config", message: "The Relay server is missing configuration.", details: err.issues } });
}

/** api/server.ts: REST API (rewritten from /api/v1/*). */
export function createApiFunctionServer(): http.Server {
  return http.createServer((req, res) => {
    try {
      const r = getRelay();
      api ??= createApi(r);
      void api(req, res);
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(err.message);
        res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(configErrorBody(err));
        return;
      }
      throw err;
    }
  });
}

/** api/ws.ts: WebSocket gateway. Plain HTTP requests get 426. */
export function createWsFunctionServer(): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(426, { "content-type": "application/json", upgrade: "websocket" });
    res.end(JSON.stringify({ error: { code: "upgrade_required", message: "Connect with a WebSocket client" } }));
  });
  server.on("upgrade", (req, socket, head) => {
    try {
      const r = getRelay();
      gateway ??= new Gateway(r);
      gateway.handleUpgrade(req, socket, head);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    }
  });
  return server;
}
