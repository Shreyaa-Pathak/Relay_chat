import { BusEvent } from "@relay/shared";
import type { Bus, BusHandler } from "./types.js";

/**
 * Single-process bus for local development and unit tests ONLY.
 * It cannot deliver across Vercel function instances; env validation refuses it in production.
 */
export class MemoryBus implements Bus {
  private handlers = new Map<string, Set<BusHandler>>();
  async subscribe(topic: string, handler: BusHandler) {
    let set = this.handlers.get(topic);
    if (!set) this.handlers.set(topic, (set = new Set()));
    set.add(handler);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      set!.delete(handler);
      if (set!.size === 0) this.handlers.delete(topic);
    };
  }
  async publish(topic: string, event: BusEvent) {
    const raw = JSON.stringify(event);
    const parsed = BusEvent.parse(JSON.parse(raw));
    queueMicrotask(() => {
      for (const h of this.handlers.get(topic) ?? []) h(parsed, raw);
    });
  }
  onRecovered() {}
  activeTopics() {
    return [...this.handlers.keys()];
  }
  async ping() {
    return true;
  }
  async close() {
    this.handlers.clear();
  }
}
