import { z } from "zod";

const csv = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []));

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url({ message: "DATABASE_URL must be a postgres:// connection string (use Neon's pooled URL on Vercel)" }),
    REDIS_URL: z.string().optional(),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (generate with: openssl rand -base64 48)"),
    APP_URL: z.string().url({ message: "APP_URL must be the public origin, e.g. https://relay.example.vercel.app" }),
    TRUSTED_ORIGINS: csv,
    /** Server closes each WebSocket after this long. Vercel Hobby functions stop at 300 s. */
    WS_MAX_CONNECTION_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(290_000),
    /** Local single-process development only: use in-memory bus/presence instead of Redis. */
    RELAY_ALLOW_MEMORY_BUS: z.enum(["0", "1"]).default("0"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    /** Per instance, per client IP. */
    REGISTER_LIMIT_PER_HOUR: z.coerce.number().int().min(1).default(10),
    /** Per instance, per IP + email. */
    LOGIN_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  })
  .superRefine((env, ctx) => {
    if (!env.REDIS_URL && env.RELAY_ALLOW_MEMORY_BUS !== "1") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "REDIS_URL is required (Upstash TLS URL: rediss://default:<password>@<host>:6379). For single-process local dev only, set RELAY_ALLOW_MEMORY_BUS=1.",
      });
    }
    if (env.RELAY_ALLOW_MEMORY_BUS === "1" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RELAY_ALLOW_MEMORY_BUS"],
        message: "The in-memory bus cannot deliver across instances and is refused in production. Configure REDIS_URL.",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema> & { trustedOrigins: string[]; secureCookies: boolean };

export class ConfigError extends Error {
  constructor(public readonly issues: { variable: string; message: string }[]) {
    super(`Relay server is not configured: ${issues.map((i) => `${i.variable}: ${i.message}`).join("; ")}`);
    this.name = "ConfigError";
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => ({ variable: String(i.path[0] ?? "env"), message: i.message })));
  }
  const env = parsed.data;
  const appOrigin = new URL(env.APP_URL).origin;
  const trustedOrigins = Array.from(new Set([appOrigin, ...env.TRUSTED_ORIGINS.map((o) => new URL(o).origin)]));
  return { ...env, trustedOrigins, secureCookies: appOrigin.startsWith("https://") };
}
