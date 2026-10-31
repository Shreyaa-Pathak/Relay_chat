import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = process.env.RELAY_API_ORIGIN ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev too: cookies and the WebSocket go through Vite to the local Relay server.
    proxy: { "/api": { target: API, ws: true } },
  },
  preview: { port: 4173, proxy: { "/api": { target: API, ws: true } } },
  build: { sourcemap: true, target: "es2022" },
});
