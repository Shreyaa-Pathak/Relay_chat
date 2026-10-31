import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "../errors.js";

export interface Req {
  raw: IncomingMessage;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
  requestId: string;
  body(): Promise<unknown>;
}

export interface Res {
  status: number;
  headers: Record<string, string | string[]>;
  body?: unknown;
}

export type Handler = (req: Req) => Promise<Res>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler) {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    const segs = path.split("/").filter(Boolean);
    let methodMismatch = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = r.parts[i]!;
        const s = segs[i]!;
        if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      return { handler: r.handler, params };
    }
    return methodMismatch ? "method" : null;
  }
}

const MAX_BODY = 32 * 1024;

export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"] ?? "";
    if (!type.includes("application/json")) {
      reject(new AppError("validation", "Expected Content-Type: application/json"));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new AppError("validation", "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AppError("validation", "Request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function send(res: ServerResponse, r: Res) {
  const headers: Record<string, string | string[]> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...r.headers,
  };
  if (r.body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  res.writeHead(r.status, headers);
  res.end(r.body !== undefined ? JSON.stringify(r.body) : undefined);
}

export const json = (status: number, body: unknown, headers: Record<string, string | string[]> = {}): Res => ({ status, body, headers });
