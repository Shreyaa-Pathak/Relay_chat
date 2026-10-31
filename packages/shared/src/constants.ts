/** Protocol version sent in `hello`. Bump when events change incompatibly. */
export const PROTOCOL_VERSION = 1;

export const LIMITS = {
  messageBodyMax: 4000,
  displayNameMax: 40,
  passwordMin: 10,
  passwordMax: 200,
  historyPageMax: 100,
  historyPageDefault: 50,
  syncPageMax: 500,
  /** Client sends at most one typing event per room/thread this often. */
  typingThrottleMs: 3000,
  /** A typing indicator disappears this long after its last refresh. */
  typingExpireMs: 5000,
  /** Server rejects typing events faster than this per connection + room. */
  typingServerMinIntervalMs: 2500,
} as const;

/** WebSocket close codes used by Relay (4000-4999 is the application range). */
export const CloseCodes = {
  /** Server reached its configured max connection lifetime; reconnect now. */
  MaxDuration: 4000,
  /** Access token missing/expired: refresh the session, then reconnect. */
  Unauthorized: 4401,
  /** Origin not trusted. Do not retry. */
  Forbidden: 4403,
  /** Client asked to close for a planned reconnect. */
  PlannedReconnect: 4100,
  /** Protocol violation (bad JSON, unknown event). */
  ProtocolError: 4002,
  /** Server shutting down (standard code 1012 "service restart"). */
  ServiceRestart: 1012,
  /** Server misconfigured (missing env). */
  ServerConfig: 4500,
} as const;

export const AVATAR_COLORS = ["lavender", "amber", "green", "blush"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export const DEFAULT_CHANNELS = [
  { slug: "general", name: "general", topic: "Anything and everything" },
  { slug: "design", name: "design", topic: "Mockups, critiques and type crimes" },
  { slug: "deploys", name: "deploys", topic: "What shipped and what broke" },
  { slug: "random", name: "random", topic: "Off-topic, on-vibe" },
] as const;
