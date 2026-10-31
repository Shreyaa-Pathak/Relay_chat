export type ErrorCode =
  | "validation"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "csrf"
  | "config"
  | "unavailable"
  | "server";

const STATUS: Record<ErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  csrf: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  config: 503,
  unavailable: 503,
  server: 500,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}
