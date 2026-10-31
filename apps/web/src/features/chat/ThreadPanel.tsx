import { useMemo } from "react";
import { ArrowLeft, X } from "lucide-react";
import { useChat } from "../../state/store";
import { byId, emptyIndex, thread } from "../../state/messages";
import { MessageBubble } from "../../components/ui/MessageBubble";
import { Button } from "../../components/ui/Button";
import { Composer } from "./Composer";
import { useController } from "./ChatContext";
import { isCompact } from "./MessageList";

export function ThreadPanel({ roomId, roomName, parentId }: { roomId: string; roomName: string; parentId: string }) {
  const ctl = useController();
  const idx = useChat((s) => s.messages[roomId]) ?? emptyIndex();
  const st = useChat((s) => s.threads[parentId]);
  const me = useChat((s) => s.me);
  const parent = byId(idx, parentId);
  const replies = useMemo(() => thread(idx, parentId), [idx, parentId]);
  const close = () => void ctl.openThread(null);

  return (
    <aside
      aria-label={`Thread in #${roomName}`}
      className="fixed inset-0 z-30 flex flex-col bg-paper md:static md:z-auto md:w-[380px] md:shrink-0 md:border-l-2 md:border-surface"
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <header className="flex items-center gap-2 border-b-2 border-surface px-3 py-3 sm:px-4">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back to channel" className="md:hidden">
          <ArrowLeft size={18} />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold tracking-tight">Thread</h2>
          <p className="truncate text-xs text-ink-muted">in #{roomName}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={close} aria-label="Close thread" className="hidden md:inline-flex">
          <X size={18} />
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto pb-3" role="log" aria-label="Replies">
        {parent && <MessageBubble message={parent} own={parent.author.id === me?.id} />}
        <div className="mx-6 my-3 flex items-center gap-3 text-xs font-semibold text-ink-muted">
          <span>{parent ? `${parent.replyCount} ${parent.replyCount === 1 ? "reply" : "replies"}` : ""}</span>
          <span className="h-0.5 flex-1 bg-surface" />
        </div>
        {st?.error && (
          <div className="mx-6 rounded-xl bg-blush p-3 text-sm" role="alert">
            Couldn't load replies. {st.error}{" "}
            <button className="font-bold underline" onClick={() => void ctl.loadReplies(parentId)}>
              Try again
            </button>
          </div>
        )}
        {!st?.loaded && st?.loading && (
          <p className="px-6 text-sm text-ink-muted" role="status">
            Loading replies…
          </p>
        )}
        {replies.map((m, i) => (
          <MessageBubble
            key={m.key}
            message={m}
            own={m.author.id === me?.id}
            compact={isCompact(replies[i - 1], m)}
            onRetry={() => ctl.retry(roomId, m.clientId)}
            onDiscard={() => ctl.discard(roomId, m.clientId)}
          />
        ))}
        {st?.hasMore && st.loaded && (
          <div className="px-6 pt-3">
            <Button size="sm" onClick={() => void ctl.loadReplies(parentId)} loading={st.loading}>
              Load more replies
            </Button>
          </div>
        )}
        {st?.loaded && replies.length === 0 && <p className="px-6 text-sm text-ink-muted">No replies yet. Start the thread below.</p>}
      </div>
      <Composer roomId={roomId} parentId={parentId} placeholder="Reply in thread" autoFocus />
    </aside>
  );
}
