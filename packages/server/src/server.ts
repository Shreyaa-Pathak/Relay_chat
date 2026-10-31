import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRelay, type Relay, type RelayOverrides } from "./context.js";
import type { Env } from "./env.js";
import { createApi } from "./http/app.js";
import { Gateway } from "./ws/gateway.js";

export interface RunningServer {
  url: string;
  wsUrl: string;
  relay: Relay;
  gateway: Gateway;
  server: http.Server;
  close(): Promise<void>;
}

/** One process serving both /api/v1/* and /api/ws. Used for local dev and integration tests. */
export async function startServer(env: Env, opts: RelayOverrides & { port?: number; host?: string; relay?: Relay } = {}): Promise<RunningServer> {
  const relay = opts.relay ?? createRelay(env, opts);
  const api = createApi(relay);
  const gateway = new Gateway(relay);
  const server = http.createServer((req, res) => void api(req, res));
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path !== "/api/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    gateway.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const host = opts.host === "0.0.0.0" ? "127.0.0.1" : (opts.host ?? "127.0.0.1");
  return {
    url: `http://${host}:${port}`,
    wsUrl: `ws://${host}:${port}/api/ws`,
    relay,
    gateway,
    server,
    async close() {
      await gateway.close();
      await new Promise<void>((r) => server.close(() => r()));
      if (!opts.relay) await relay.close();
    },
  };
}
