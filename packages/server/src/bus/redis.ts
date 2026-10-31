import { Redis } from "ioredis";
import { BusEvent } from "@relay/shared";
import type { Logger } from "../log.js";
import type { Bus, BusHandler } from "./types.js";

interface TopicState {
  handlers: Set<BusHandler>;
  /** Resolves when Redis confirmed SUBSCRIBE. */
  ready: Promise<void>;
  lingerTimer: NodeJS.Timeout | null;
}

export interface RedisBusOptions {
  /** Keep a topic subscribed this long after its last local handler leaves (absorbs reconnect churn). */
  lingerMs?: number;
  prefix?: string;
}

/**
 * Redis pub/sub bus with separate publisher and subscriber connections (a subscribed connection
 * can't publish). Topics are reference-counted per instance; SUBSCRIBE/UNSUBSCRIBE commands are
 * only issued on the first handler / after the last handler + linger, which keeps Upstash
 * command usage proportional to rooms-per-instance, not to connections.
 */
export class RedisBus implements Bus {
  private pub: Redis;
  private sub: Redis;
  private topics = new Map<string, TopicState>();
  private recoveredCbs: (() => void)[] = [];
  private readonly lingerMs: number;
  private readonly prefix: string;
  private closed = false;
  private everReady = false;

  constructor(url: string, private readonly log: Logger, opts: RedisBusOptions = {}) {
    this.lingerMs = opts.lingerMs ?? 30_000;
    this.prefix = opts.prefix ?? "relay:";
    const common = {
      // Fail fast on publish when Redis is down instead of queueing unboundedly.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      retryStrategy: (times: number) => Math.min(times * 200, 5_000),
      lazyConnect: false,
    };
    this.pub = new Redis(url, { ...common, connectionName: "relay-pub" });
    this.sub = new Redis(url, { ...common, connectionName: "relay-sub", autoResubscribe: true });
    for (const [name, c] of [["pub", this.pub], ["sub", this.sub]] as const) {
      c.on("error", (err: Error) => this.log.warn("redis error", { conn: name, err: err.message }));
    }
    this.sub.on("ready", () => {
      if (this.everReady) {
        this.log.info("redis subscriber recovered", { topics: this.topics.size });
        for (const cb of this.recoveredCbs) cb();
      }
      this.everReady = true;
    });
    this.sub.on("message", (channel: string, raw: string) => {
      const topic = channel.startsWith(this.prefix) ? channel.slice(this.prefix.length) : channel;
      const state = this.topics.get(topic);
      if (!state || state.handlers.size === 0) return;
      let event: BusEvent;
      try {
        event = BusEvent.parse(JSON.parse(raw));
      } catch (err) {
        this.log.warn("dropping malformed bus event", { topic, err: (err as Error).message });
        return;
      }
      for (const h of state.handlers) {
        try {
          h(event, raw);
        } catch (err) {
          this.log.error("bus handler failed", { topic, err });
        }
      }
    });
  }

  async subscribe(topic: string, handler: BusHandler): Promise<() => void> {
    let state = this.topics.get(topic);
    if (!state) {
      const ready = this.sub.subscribe(this.prefix + topic).then(() => undefined);
      state = { handlers: new Set(), ready, lingerTimer: null };
      this.topics.set(topic, state);
      ready.catch(() => {
        // Let a later subscribe retry.
        if (this.topics.get(topic) === state && state!.handlers.size === 0) this.topics.delete(topic);
      });
    }
    if (state.lingerTimer) {
      clearTimeout(state.lingerTimer);
      state.lingerTimer = null;
    }
    state.handlers.add(handler);
    try {
      await state.ready;
    } catch (err) {
      state.handlers.delete(handler);
      if (state.handlers.size === 0) this.topics.delete(topic);
      throw err;
    }
    let done = false;
    const s = state;
    return () => {
      if (done) return;
      done = true;
      s.handlers.delete(handler);
      if (s.handlers.size === 0 && !s.lingerTimer && !this.closed) {
        s.lingerTimer = setTimeout(() => {
          s.lingerTimer = null;
          if (s.handlers.size === 0 && this.topics.get(topic) === s) {
            this.topics.delete(topic);
            this.sub.unsubscribe(this.prefix + topic).catch((err: Error) => this.log.warn("unsubscribe failed", { topic, err: err.message }));
          }
        }, this.lingerMs);
        s.lingerTimer.unref?.();
      }
    };
  }

  async publish(topic: string, event: BusEvent): Promise<void> {
    await this.pub.publish(this.prefix + topic, JSON.stringify(event));
  }

  onRecovered(cb: () => void) {
    this.recoveredCbs.push(cb);
  }

  activeTopics() {
    return [...this.topics.keys()];
  }

  async ping() {
    try {
      return (await this.pub.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  /** Shared command connection for presence (not usable for SUBSCRIBE). */
  get commands(): Redis {
    return this.pub;
  }

  async close() {
    this.closed = true;
    for (const s of this.topics.values()) if (s.lingerTimer) clearTimeout(s.lingerTimer);
    this.topics.clear();
    await Promise.allSettled([this.sub.quit(), this.pub.quit()]);
  }
}

/** Retries a publish a few times with short backoff. */
export async function publishWithRetry(bus: Bus, topic: string, event: BusEvent, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await bus.publish(topic, event);
      return true;
    } catch {
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 50 * 3 ** i));
    }
  }
  return false;
}
