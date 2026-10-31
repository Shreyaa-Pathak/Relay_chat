import { memo } from "react";
import { AlertCircle, Check, Clock, MessageSquare, RotateCw, X } from "lucide-react";
import type { ClientMessage } from "../../state/messages";
import { Avatar } from "./Avatar";
import { cx } from "./cx";

export interface MessageBubbleProps {
  message: ClientMessage;
  own: boolean;
  /** Hide name/avatar when the previous message is from the same author a moment ago. */
  compact?: boolean;
  onRetry?: () => void;
  onDiscard?: () => void;
  onOpenThread?: () => void;
  threadOpen?: boolean;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Status({ m }: { m: ClientMessage }) {
  if (m.status === "pending")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
        <Clock size={12} aria-hidden /> Sending…
      </span>
    );
  if (m.status === "sent")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
        <Check size={12} aria-hidden /> Sent
      </span>
    );
  return null;
}

export const MessageBubble = memo(function MessageBubble({ message: m, own, compact, onRetry, onDiscard, onOpenThread, threadOpen }: MessageBubbleProps) {
  const failed = m.status === "failed";
  return (
    <article
      className={cx("group flex gap-2.5 px-4 sm:px-6", compact ? "pt-1" : "pt-3", own && "flex-row-reverse")}
      aria-label={`${m.author.displayName}, ${time(m.createdAt)}`}
    >
      <div className="w-9 shrink-0">{!compact && !own && <Avatar name={m.author.displayName} color={m.author.avatarColor} />}</div>
      <div className={cx("flex min-w-0 max-w-[78%] flex-col", own ? "items-end" : "items-start")}>
        {!compact && (
          <div className={cx("mb-1 flex items-baseline gap-2 text-sm", own && "flex-row-reverse")}>
            <span className="font-bold">{own ? "You" : m.author.displayName}</span>
            <time dateTime={m.createdAt} className="text-xs text-ink-muted">
              {time(m.createdAt)}
            </time>
          </div>
        )}
        <div
          className={cx(
            "rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap break-words",
            own ? "bg-mint text-ink rounded-tr-md" : "bg-surface text-ink rounded-tl-md",
            m.status === "pending" && "opacity-70",
            failed && "bg-blush border-2 border-dashed border-ink",
          )}
        >
          {m.body}
        </div>
        <div className={cx("mt-1 flex flex-wrap items-center gap-3", own && "flex-row-reverse")}>
          {own && !failed && <Status m={m} />}
          {failed && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-xs font-semibold">
              <AlertCircle size={13} aria-hidden /> Not sent. {m.error}
              {m.retryable !== false && onRetry && (
                <button type="button" onClick={onRetry} className="ml-1 inline-flex items-center gap-1 underline underline-offset-2">
                  <RotateCw size={12} aria-hidden /> Retry
                </button>
              )}
              {onDiscard && (
                <button type="button" onClick={onDiscard} className="inline-flex items-center gap-1 underline underline-offset-2">
                  <X size={12} aria-hidden /> Discard
                </button>
              )}
            </span>
          )}
          {onOpenThread && m.id && (
            <button
              type="button"
              onClick={onOpenThread}
              aria-expanded={threadOpen}
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                m.replyCount > 0 ? "bg-mint-tint hover:bg-mint" : "text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-surface",
              )}
            >
              <MessageSquare size={12} aria-hidden />
              {m.replyCount > 0 ? `${m.replyCount} ${m.replyCount === 1 ? "reply" : "replies"}` : "Reply in thread"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
