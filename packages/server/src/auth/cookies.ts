import type { IncomingMessage } from "node:http";

export const ACCESS_COOKIE = "relay_at";
export const REFRESH_COOKIE = "relay_rt";
/** Refresh cookie is only sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeS: number;
  path: string;
  secure: boolean;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`, `Max-Age=${o.maxAgeS}`, "HttpOnly", "SameSite=Lax"];
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, path: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeS: 0, path, secure });
}
