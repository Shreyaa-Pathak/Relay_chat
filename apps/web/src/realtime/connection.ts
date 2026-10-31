import { ClientEvent, CloseCodes, ServerEvent, type HelloEvent } from "@relay/shared";
import { backoffDelay, plannedReconnectDelay } from "./backoff";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  /** First connection is slow: likely a cold start. */
  | "waking"
  | "open"
  | "reconnecting"
  | "offline"
  | "unauthorized"
  | "closed";

export interface ConnectionEvents {
  status: (s: ConnectionStatus, info: { attempt: number; nextRetryAt: number | null }) => void;
  /** A socket finished its handshake and became the active one (first connect or any reconnect). */
  ready: (hello: HelloEvent) => void;
  event: (e: ServerEvent) => void;
  /** The server rejected our access token. Refresh the session and call connect() again, or stop(). */
  unauthorized: () => void;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  rand?: () => number;
  /** How long the first connect may take before we show "waking". */
  wakeAfterMs?: number;
}

const OPEN = 1;

/**
 * Owns the WebSocket lifecycle:
 * - exponential backoff with jitter (cap 30 s) after unexpected drops
 * - planned "make-before-break" reconnect before the server's max lifetime: a new socket is
 *   opened and handshaken *before* the old one is closed, so there is never a moment without one
 * - immediate reconnect when the browser comes back online
 */
export class RelayConnection {
  private active: SocketLike | null = null;
  private next: SocketLike | null = null;
  private attempt = 0;
  private stopped = true;
  private status: ConnectionStatus = "idle";
  private everConnected = false;
  private timers = new Set<unknown>();
  private retryTimer: unknown = null;
  private plannedTimer: unknown = null;
  private listeners: { [K in keyof ConnectionEvents]: Set<ConnectionEvents[K]> } = {
    status: new Set(),
    ready: new Set(),
    event: new Set(),
    unauthorized: new Set(),
  };
  private o: Required<ConnectionOptions>;

  constructor(opts: ConnectionOptions) {
    this.o = {
      createSocket: (u) => new WebSocket(u) as unknown as SocketLike,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      rand: Math.random,
      wakeAfterMs: 2500,
      ...opts,
    };
  }

  on<K extends keyof ConnectionEvents>(k: K, fn: ConnectionEvents[K]): () => void {
    this.listeners[k].add(fn);
    return () => this.listeners[k].delete(fn);
  }

  private emit<K extends keyof ConnectionEvents>(k: K, ...args: Parameters<ConnectionEvents[K]>) {
    for (const fn of this.listeners[k]) (fn as (...a: Parameters<ConnectionEvents[K]>) => void)(...args);
  }

  getStatus() {
    return this.status;
  }

  private setStatus(s: ConnectionStatus, nextRetryAt: number | null = null) {
    this.status = s;
    this.emit("status", s, { attempt: this.attempt, nextRetryAt });
  }

  private timer(fn: () => void, ms: number) {
    const t = this.o.setTimer(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private cancel(t: unknown) {
    if (t == null) return;
    this.o.clearTimer(t);
    this.timers.delete(t);
  }

  connect() {
    this.stopped = false;
    this.cancel(this.retryTimer);
    this.retryTimer = null;
    if (this.active && this.active.readyState === OPEN) return;
    this.openSocket(false);
  }

  /** Called by the app when the browser reports it is back online. */
  nudge() {
    if (this.stopped) return;
    if (!this.active || this.active.readyState !== OPEN) {
      this.attempt = 0;
      this.connect();
    }
  }

  /**
   * The browser reports it lost the network. An existing socket can look open for a long time
   * after that (until a heartbeat fails), so drop it now and wait for `nudge()` on "online".
   * Unsent messages stay queued in the controller and are resent with their original clientIds.
   */
  markOffline() {
    if (this.stopped) return;
    this.cancel(this.retryTimer);
    this.retryTimer = null;
    this.cancel(this.plannedTimer);
    for (const s of [this.active, this.next]) {
      if (!s) continue;
      this.detach(s);
      try {
        s.close(1000, "browser offline");
      } catch {
        /* ignore */
      }
    }
    this.active = null;
    this.next = null;
    this.setStatus("offline");
  }

  send(ev: ClientEvent): boolean {
    const s = this.active;
    if (!s || s.readyState !== OPEN) return false;
    s.send(JSON.stringify(ev));
    return true;
  }

  isOpen() {
    return !!this.active && this.active.readyState === OPEN && this.status === "open";
  }

  private openSocket(planned: boolean) {
    if (!planned) this.setStatus(this.everConnected ? "reconnecting" : "connecting");
    let sock: SocketLike;
    try {
      sock = this.o.createSocket(this.o.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    if (planned) this.next = sock;
    else {
      this.detach(this.active);
      this.active = sock;
    }
    let wakeTimer: unknown = null;
    if (!this.everConnected && !planned) {
      wakeTimer = this.timer(() => {
        if (this.status === "connecting") this.setStatus("waking");
      }, this.o.wakeAfterMs);
    }
    let handshaken = false;

    sock.onmessage = (msg) => {
      let parsed: ServerEvent;
      try {
        const r = ServerEvent.safeParse(JSON.parse(String(msg.data)));
        if (!r.success) return;
        parsed = r.data;
      } catch {
        return;
      }
      if (parsed.type === "hello") {
        handshaken = true;
        this.cancel(wakeTimer);
        this.onHello(sock, parsed);
        return;
      }
      this.emit("event", parsed);
    };
    sock.onerror = () => {
      /* onclose follows */
    };
    sock.onclose = (ev) => {
      this.cancel(wakeTimer);
      this.onSocketClose(sock, ev.code, handshaken);
    };
  }

  private onHello(sock: SocketLike, hello: HelloEvent) {
    if (this.next === sock) {
      // Planned handover: the new socket is ready, retire the old one.
      const old = this.active;
      this.active = sock;
      this.next = null;
      if (old && old.readyState === OPEN) {
        try {
          old.send(JSON.stringify({ type: "bye", reason: "reconnect" } satisfies ClientEvent));
        } catch {
          /* ignore */
        }
      }
      this.detach(old);
      old?.close(CloseCodes.PlannedReconnect, "planned reconnect");
    } else if (this.active !== sock) {
      return;
    }
    this.everConnected = true;
    this.attempt = 0;
    this.setStatus("open");
    this.cancel(this.plannedTimer);
    this.plannedTimer = this.timer(() => this.plannedReconnect(), plannedReconnectDelay(hello.maxConnectionMs, this.o.rand));
    this.emit("ready", hello);
  }

  private plannedReconnect() {
    if (this.stopped || this.next) return;
    this.openSocket(true);
  }

  private detach(s: SocketLike | null) {
    if (!s) return;
    s.onclose = null;
    s.onmessage = null;
    s.onopen = null;
    s.onerror = null;
  }

  private onSocketClose(sock: SocketLike, code: number, handshaken: boolean) {
    if (sock === this.next) {
      // Planned replacement failed; keep the active socket and let the normal path recover.
      this.next = null;
      if (!this.stopped && this.active?.readyState === OPEN) {
        this.plannedTimer = this.timer(() => this.plannedReconnect(), backoffDelay(this.attempt++, 1000, 30_000, this.o.rand));
      }
      return;
    }
    if (sock !== this.active) return;
    this.active = null;
    this.cancel(this.plannedTimer);
    if (this.next) {
      // Server closed the old socket while the replacement was still handshaking: promote it.
      this.active = this.next;
      this.next = null;
      this.setStatus("reconnecting");
      return;
    }
    if (this.stopped) {
      this.setStatus("closed");
      return;
    }
    if (code === CloseCodes.Unauthorized) {
      this.setStatus("unauthorized");
      this.emit("unauthorized");
      return;
    }
    if (code === CloseCodes.Forbidden) {
      this.stopped = true;
      this.setStatus("closed");
      return;
    }
    const planned = code === CloseCodes.MaxDuration || code === CloseCodes.PlannedReconnect;
    if (planned && handshaken) {
      // Expected end of life: reconnect right away, with a little jitter so clients spread out.
      this.attempt = 0;
      this.setStatus("reconnecting");
      this.retryTimer = this.timer(() => this.openSocket(false), Math.round(this.o.rand() * 500));
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.stopped) return;
    if (this.status === "offline") return; // resumed by nudge() when the browser is back online
    const delay = backoffDelay(this.attempt++, 500, 30_000, this.o.rand);
    this.setStatus("reconnecting", this.o.now() + delay);
    this.cancel(this.retryTimer);
    this.retryTimer = this.timer(() => this.openSocket(false), delay);
  }

  /** Close for good (sign-out, unmount). */
  stop(reason: "logout" | "leave" = "leave") {
    this.stopped = true;
    for (const t of this.timers) this.o.clearTimer(t);
    this.timers.clear();
    for (const s of [this.active, this.next]) {
      if (!s) continue;
      if (s.readyState === OPEN) {
        try {
          s.send(JSON.stringify({ type: "bye", reason } satisfies ClientEvent));
        } catch {
          /* ignore */
        }
      }
      this.detach(s);
      s.close(1000, reason);
    }
    this.active = null;
    this.next = null;
    this.setStatus("closed");
  }
}
