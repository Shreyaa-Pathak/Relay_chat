import * as RD from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <RD.Content
          className={cx(
            "fixed top-1/2 left-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border-2 border-ink bg-paper p-6 shadow-sticker",
            className,
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <RD.Title className="text-xl font-extrabold tracking-tight">{title}</RD.Title>
            <RD.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X size={18} />
              </Button>
            </RD.Close>
          </div>
          {description ? <RD.Description className="mb-4 text-ink-muted">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
          {children}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
