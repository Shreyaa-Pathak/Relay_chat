import { useEffect, useState } from "react";
import { CloudOff, Loader2, Wifi } from "lucide-react";
import type { ConnectionStatus as Status } from "../../realtime/connection";
import { cx } from "./cx";

const label: Record<Status, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  waking: "Waking up the server…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  offline: "You're offline",
  unauthorized: "Refreshing your session…",
  closed: "Disconnected",
};

/** Text + icon status (never colour alone). */
export function ConnectionStatus({ status, nextRetryAt, compact }: { status: Status; nextRetryAt: number | null; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!nextRetryAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [nextRetryAt]);
  const secs = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : 0;
  const ok = status === "open";
  const busy = status === "connecting" || status === "waking" || status === "reconnecting" || status === "unauthorized";
  const Icon = ok ? Wifi : busy ? Loader2 : CloudOff;
  const text = status === "reconnecting" && secs > 1 ? `Reconnecting in ${secs}s…` : label[status];
  if (compact && ok) return null;
  return (
    <span role="status" className={cx("inline-flex items-center gap-1.5 text-xs font-semibold", ok ? "text-ink-muted" : "text-ink")}>
      <Icon size={13} aria-hidden className={cx(busy && "animate-spin")} />
      {text}
    </span>
  );
}
