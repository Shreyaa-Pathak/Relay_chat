// Vercel Function: WebSocket gateway at wss://<host>/api/ws
// Contract (verified against vercel.com/docs/functions/websockets, Oct 2026): a Node.js function
// may default-export an http.Server with a `ws` WebSocketServer attached. Requires Fluid compute.
import { createWsFunctionServer } from "@relay/server";

export default createWsFunctionServer();
