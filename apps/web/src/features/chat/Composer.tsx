import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";
import { LIMITS } from "@relay/shared";
import { useChat } from "../../state/store";
import { Button } from "../../components/ui/Button";
import { ConnectionStatus } from "../../components/ui/ConnectionStatus";
import { activeTypers, typingKey, typingLabel } from "../../realtime/typing";
import { useController, useNow } from "./ChatContext";

export function Composer({ roomId, parentId, placeholder, autoFocus }: { roomId: string; parentId: string | null; placeholder: string; autoFocus?: boolean }) {
  const ctl = useController();
  const conn = useChat((s) => s.conn);
  const typingMap = useChat((s) => s.typing[typingKey(roomId, parentId)]);
  const now = useNow(1000, !!typingMap && Object.keys(typingMap).length > 0);
  const typers = activeTypers(typingMap ? { k: typingMap } : {}, "k", now);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = `composer-${parentId ?? roomId}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const tooLong = value.length > LIMITS.messageBodyMax;
  const submit = () => {
    if (!value.trim() || tooLong) return;
    ctl.send(roomId, value, parentId);
    setValue("");
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const offline = conn.status !== "open";
  return (
    <div className="border-t-2 border-surface px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="flex min-h-5 items-center justify-between gap-3 pb-1.5" aria-live="polite">
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          {typers.length > 0 && (
            <>
              <span aria-hidden className="inline-flex gap-0.5">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink" />
              </span>
              {typingLabel(typers)}
            </>
          )}
        </span>
        <ConnectionStatus status={conn.status} nextRetryAt={conn.nextRetryAt} compact />
      </div>
      <form
        className="flex items-end gap-2 rounded-3xl border-2 border-ink bg-paper p-1.5 pl-4 focus-within:shadow-sticker-sm"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value.trim()) ctl.typing(roomId, parentId);
          }}
          onKeyDown={onKeyDown}
          aria-describedby={`${id}-hint`}
          className="max-h-[200px] min-h-10 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed placeholder:text-ink-muted focus-visible:outline-none"
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Send message" disabled={!value.trim() || tooLong}>
          <SendHorizontal size={18} />
        </Button>
      </form>
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
        {tooLong
          ? `${value.length - LIMITS.messageBodyMax} characters over the limit.`
          : offline
            ? "You can keep typing. Messages send automatically when you're reconnected."
            : "Enter to send, Shift+Enter for a new line."}
      </p>
    </div>
  );
}
