import { useState } from "react";
import { DoorOpen, Menu } from "lucide-react";
import { useNavigate } from "react-router";
import type { Room } from "@relay/shared";
import { useChat, toast } from "../../state/store";
import { onlineUsers } from "../../state/presence";
import { Button } from "../../components/ui/Button";
import { Pill } from "../../components/ui/Pill";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { ThreadPanel } from "./ThreadPanel";
import { OnlineDialog } from "./Dialogs";
import { useController, useNow } from "./ChatContext";

export function ChannelView({ room, onOpenMenu }: { room: Room; onOpenMenu: () => void }) {
  const ctl = useController();
  const nav = useNavigate();
  const presence = useChat((s) => s.presence);
  const offset = useChat((s) => s.serverOffset);
  const openThreadId = useChat((s) => s.openThreadId);
  const now = useNow(15_000);
  const count = onlineUsers(presence, now + offset).length;
  const [showOnline, setShowOnline] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <section aria-label={`#${room.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b-2 border-surface px-3 py-3 sm:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open channel list" onClick={onOpenMenu}>
            <Menu size={20} />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-[28px]">
              <span aria-hidden className="mr-0.5">#</span>
              {room.name}
            </h1>
            {room.topic && <p className="truncate text-sm text-ink-muted">{room.topic}</p>}
          </div>
          <button type="button" onClick={() => setShowOnline(true)} aria-label={`${count} online. Show who's online`} className="rounded-full">
            <Pill tone="quiet" className="font-semibold hover:bg-mint-tint">
              <span aria-hidden className="h-2 w-2 rounded-full bg-mint-strong ring-1 ring-ink" />
              {count} online
            </Pill>
          </button>
          <Button variant="ghost" size="icon" aria-label={`Leave #${room.name}`} onClick={() => setConfirmLeave(true)}>
            <DoorOpen size={18} />
          </Button>
        </header>
        <MessageList roomId={room.id} roomName={room.name} />
        <Composer roomId={room.id} parentId={null} placeholder={`Message #${room.name}`} />
      </section>
      {openThreadId && <ThreadPanel roomId={room.id} roomName={room.name} parentId={openThreadId} />}
      <OnlineDialog open={showOnline} onOpenChange={setShowOnline} now={now} />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`Leave #${room.name}?`}
        description="You'll stop receiving its messages. You can rejoin any time from Browse channels."
        confirmLabel="Leave channel"
        busy={leaving}
        onConfirm={async () => {
          setLeaving(true);
          try {
            await ctl.leave(room.id);
            toast(`You left #${room.name}`);
            setConfirmLeave(false);
            nav("/c/general");
          } catch (e) {
            toast((e as Error).message, "error");
          } finally {
            setLeaving(false);
          }
        }}
      />
    </div>
  );
}
