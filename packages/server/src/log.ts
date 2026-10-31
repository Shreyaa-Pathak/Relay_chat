type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never written to logs. */
const REDACT = new Set(["password", "passwordHash", "token", "accessToken", "refreshToken", "cookie", "authorization", "body", "secret"]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 6).join("\n") };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.has(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(level: Level = "info", base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const write = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (order[lvl] < order[level]) return;
    sink(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...(redact(base) as object), ...(redact(fields ?? {}) as object) }));
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, sink),
  };
}
