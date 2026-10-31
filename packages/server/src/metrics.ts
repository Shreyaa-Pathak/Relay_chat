/** Per-instance counters. On Vercel each request may hit a different instance; aggregate via logs. */
export class Metrics {
  readonly startedAt = Date.now();
  connectionsOpen = 0;
  connectionsTotal = 0;
  messagesCommitted = 0;
  messagesDuplicate = 0;
  sendErrors = 0;
  publishFailures = 0;
  busEventsIn = 0;
  private commitMs: number[] = [];

  recordCommit(ms: number) {
    this.commitMs.push(ms);
    if (this.commitMs.length > 1000) this.commitMs.shift();
  }

  snapshot() {
    const sorted = [...this.commitMs].sort((a, b) => a - b);
    const pct = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null);
    return {
      scope: "this instance",
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
      connectionsOpen: this.connectionsOpen,
      connectionsTotal: this.connectionsTotal,
      messagesCommitted: this.messagesCommitted,
      messagesDuplicate: this.messagesDuplicate,
      sendErrors: this.sendErrors,
      publishFailures: this.publishFailures,
      busEventsIn: this.busEventsIn,
      commitLatencyMs: { p50: pct(50), p95: pct(95), p99: pct(99), samples: sorted.length },
    };
  }
}
