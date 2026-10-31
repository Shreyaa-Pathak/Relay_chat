import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

const ISS = "relay";
const AUD = "relay";

const keyCache = new Map<string, Uint8Array>();
function key(secret: string): Uint8Array {
  let k = keyCache.get(secret);
  if (!k) {
    k = new TextEncoder().encode(secret);
    keyCache.set(secret, k);
  }
  return k;
}

export interface AccessClaims {
  sub: string;
}

export async function signAccessToken(secret: string, userId: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_S)
    .sign(key(secret));
}

/** Returns the user id, or null if the token is missing, malformed, expired or forged. */
export async function verifyAccessToken(secret: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISS, audience: AUD, algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
