import { X } from "lucide-react";
import { dismissToast, useChat } from "../../state/store";
import { cx } from "./cx";

export function Toasts() {
  const toasts = useChat((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto flex items-start justify-between gap-3 rounded-2xl border-2 border-ink px-4 py-3 text-sm shadow-sticker",
            t.tone === "error" ? "bg-blush" : t.tone === "success" ? "bg-mint" : "bg-paper",
          )}
        >
          <span>{t.text}</span>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="shrink-0">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
