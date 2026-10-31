import bcrypt from "bcryptjs";

/** bcrypt cost 12 in production (~250 ms per hash); tests lower it via BCRYPT_COST. */
const COST = Number(process.env.BCRYPT_COST ?? 12);

// A real hash of a random string, used so unknown-email logins take as long as wrong-password ones.
let dummyHash: string | null = null;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (!hash) {
    dummyHash ??= await bcrypt.hash("relay-timing-equaliser", COST);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
