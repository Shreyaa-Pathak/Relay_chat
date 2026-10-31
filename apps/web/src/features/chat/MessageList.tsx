import { useCallback, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useChat } from "../../state/store";
import { emptyIndex, timeline, type ClientMessage } from "../../state/messages";
import { MessageBubble } from "../../components/ui/MessageBubble";
import { Button } from "../../components/ui/Button";
import { useController } from "./ChatContext";

const GROUP_MS = 5 * 60_000;

export function isCompact(prev: ClientMessage | undefined, m: ClientMessage) {
  return !!prev && prev.author.id === m.author.id && Math.abs(Date.parse(m.createdAt) - Date.parse(prev.createdAt)) < GROUP_MS;
}

export function MessageList({ roomId, roomName }: { roomId: string; roomName: string }) {
  const ctl = useController();
  const idx = useChat((s) => s.messages[roomId]);
  const hist = useChat((s) => s.history[roomId]);
  const me = useChat((s) => s.me);
  const openThreadId = useChat((s) => s.openThreadId);
  const items = useMemo(() => timeline(idx ?? emptyIndex()), [idx]);
  const ref = useRef<VirtuosoHandle>(null);
  // Keep the visual position stable when older messages are prepended.
  const firstIndex = useRef(1_000_000);
  const prevLen = useRef(0);
  const prevFirstKey = useRef<string | undefined>(undefined);
  if (items.length !== prevLen.current) {
    if (prevFirstKey.current && items[0]?.key !== prevFirstKey.current) {
      const added = items.findIndex((m) => m.key === prevFirstKey.current);
      if (added > 0) firstIndex.current -= added;
    }
    prevLen.current = items.length;
    prevFirstKey.current = items[0]?.key;
  }

  const loadOlder = useCallback(() => void ctl.loadOlder(roomId), [ctl, roomId]);

  if (!hist?.loaded && hist?.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-semibold">Couldn't load #{roomName}.</p>
        <p className="text-sm text-ink-muted">{hist.error}</p>
        <Button variant="primary" onClick={loadOlder}>
          Try again
        </Button>
      </div>
    );
  }
  if (!hist?.loaded) {
    return (
      <div className="flex flex-1 items-center justify-center text-ink-muted" role="status" aria-busy="true">
        Loading messages…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-2xl font-extrabold tracking-tight">#{roomName} is quiet.</p>
        <p className="text-ink-muted">Say hello. Your first message starts the conversation.</p>
      </div>
    );
  }

  return (
    <Virtuoso
      ref={ref}
      className="flex-1"
      role="log"
      aria-label={`Messages in #${roomName}`}
      aria-live="polite"
      data={items}
      firstItemIndex={firstIndex.current}
      initialTopMostItemIndex={items.length - 1}
      computeItemKey={(_, m) => m.key}
      followOutput={(atBottom) => (atBottom ? "smooth" : false)}
      atBottomThreshold={120}
      startReached={() => hist.hasMore && loadOlder()}
      increaseViewportBy={{ top: 400, bottom: 200 }}
      components={{
        Header: () => (
          <div className="flex justify-center py-3 text-xs text-ink-muted">
            {hist.loading ? "Loading earlier messages…" : hist.hasMore ? "" : `This is the start of #${roomName}.`}
          </div>
        ),
        Footer: () => <div className="h-3" />,
      }}
      itemContent={(i, m) => {
        const local = i - firstIndex.current;
        return (
          <MessageBubble
            message={m}
            own={m.author.id === me?.id}
            compact={isCompact(items[local - 1], m)}
            threadOpen={openThreadId === m.id}
            onOpenThread={m.id ? () => void ctl.openThread(m.id) : undefined}
            onRetry={() => ctl.retry(roomId, m.clientId)}
            onDiscard={() => ctl.discard(roomId, m.clientId)}
          />
        );
      }}
    />
  );
}
