import type { BusEvent } from "@relay/shared";

export type BusHandler = (event: BusEvent, raw: string) => void;

export interface Bus {
  /**
   * Registers a handler for a topic. Resolves once the subscription is active, so callers can
   * read the room's last seq *after* this and be sure no later event is missed.
   * Returns an idempotent unsubscribe function.
   */
  subscribe(topic: string, handler: BusHandler): Promise<() => void>;
  /** Publishes to every instance (including this one). Rejects if the transport fails. */
  publish(topic: string, event: BusEvent): Promise<void>;
  /** Called after the transport reconnects; subscriptions are restored but events may have been missed. */
  onRecovered(cb: () => void): void;
  /** Number of topics with an active transport subscription (for tests/metrics). */
  activeTopics(): string[];
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
