import { useState } from "react";
import { useNavigate } from "react-router";
import { useChat, toast } from "../../state/store";
import { onlineUsers } from "../../state/presence";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useController } from "./ChatContext";

export function BrowseChannelsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const rooms = useChat((s) => s.rooms);
  const ctl = useController();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Browse channels" description="Join a channel to read and post in it.">
      <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
        {rooms.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl bg-surface px-3 py-2">
            <div className="min-w-0">
              <p className="font-bold">#{r.name}</p>
              <p className="truncate text-xs text-ink-muted">
                {r.topic ?? "No topic"} ({r.memberCount} {r.memberCount === 1 ? "member" : "members"})
              </p>
            </div>
            {r.isMember ? (
              <Button
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  nav(`/c/${r.slug}`);
                }}
              >
                Open
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={busy === r.id}
                onClick={async () => {
                  setBusy(r.id);
                  try {
                    await ctl.join(r.id);
                    toast(`Joined #${r.name}`, "success");
                    onOpenChange(false);
                    nav(`/c/${r.slug}`);
                  } catch (e) {
                    toast((e as Error).message, "error");
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Join
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function OnlineDialog({ open, onOpenChange, now }: { open: boolean; onOpenChange: (o: boolean) => void; now: number }) {
  const presence = useChat((s) => s.presence);
  const offset = useChat((s) => s.serverOffset);
  const me = useChat((s) => s.me);
  const users = onlineUsers(presence, now + offset);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`${users.length} online`}>
      {users.length === 0 ? (
        <p className="text-ink-muted">Nobody else is here right now.</p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3">
              <Avatar name={u.displayName} color={u.avatarColor} online />
              <span className="font-semibold">
                {u.displayName}
                {u.id === me?.id && <span className="font-normal text-ink-muted"> (you)</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
