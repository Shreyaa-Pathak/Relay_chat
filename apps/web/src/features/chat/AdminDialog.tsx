import { useCallback, useEffect, useState } from "react";
import type { AdminMember, Room } from "@relay/shared";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog, Dialog } from "../../components/ui/Dialog";
import { useController } from "./ChatContext";

const fieldClass = "w-full rounded-xl border-2 border-ink bg-paper px-3 py-2";

export function AdminDialog({ communityId, open, onOpenChange }: { communityId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const ctl = useController();
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<Room | null>(null);

  const load = useCallback(async () => {
    const [people, channels] = await Promise.all([api.adminMembers(communityId), api.adminRooms(communityId)]);
    setMembers(people.members);
    setRooms(channels.rooms);
    setLoaded(true);
  }, [communityId]);

  useEffect(() => {
    if (open) {
      setError("");
      setLoaded(false);
      void load().catch((e: Error) => setError(e.message));
    }
  }, [open, load]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await Promise.all([load(), ctl.loadRooms()]);
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [editingChannel, setEditingChannel] = useState<string>("");

  const visible = members.filter((m) => (!channel || m.roomIds.includes(channel)) && (!status || m.status === status)
    && `${m.displayName} ${m.email}`.toLowerCase().includes(search.toLowerCase()));

  return <>
    <Dialog open={open} onOpenChange={onOpenChange} title="Members and channels" description="Manage members and channels in this community." className="max-h-[90dvh] w-[min(94vw,800px)] overflow-y-auto">
      {error && <p role="alert" className="mb-3 rounded-xl bg-blush p-3">{error} <Button size="sm" disabled={busy} onClick={() => void act(load, "Refreshed.")}>Retry</Button></p>}
      {notice && <p role="status" className="mb-3 rounded-xl bg-mint p-3">{notice}</p>}
      {!loaded ? <p>Loading members and channels...</p> : <div className="flex flex-col gap-6">
        <section aria-label="Workspace members">
          <h3 className="mb-2 font-bold">Members ({visible.length})</h3>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <input aria-label="Search members" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className={fieldClass} />
            <select aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value)} className={fieldClass}><option value="">All channels</option>{rooms.map((r) => <option key={r.id} value={r.id}>#{r.name}</option>)}</select>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClass}><option value="">All statuses</option>{["active", "blocked"].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <ul className="flex flex-col gap-2">{visible.map((m) => <li key={m.id} className="rounded-xl border border-ink/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0"><p className="break-words font-bold">{m.displayName} <span className="text-xs font-normal">{m.role} · {m.status}</span></p><p className="break-all text-sm text-ink-muted">{m.email}</p></div>
              {m.role !== "owner" && <div className="flex flex-wrap gap-1">
                {m.status !== "active" && <Button size="sm" disabled={busy} onClick={() => void act(() => api.moderate(communityId, m.id, "active"), "Member allowed.")}>Restore</Button>}
                {m.status !== "blocked" && <Button size="sm" variant="danger" disabled={busy} onClick={() => void act(() => api.moderate(communityId, m.id, "blocked"), "Member blocked.")}>Block</Button>}
              </div>}
            </div>
            <p className="mt-1 text-xs text-ink-muted">{rooms.filter((r) => m.roomIds.includes(r.id)).map((r) => `#${r.name}`).join(", ") || "No channels"}</p>
          </li>)}</ul>
          {visible.length === 0 && <p className="text-sm text-ink-muted">No members match these filters.</p>}
        </section>
        <section aria-label="Manage channels">
          <h3 className="mb-2 font-bold">Channels</h3>
          <ul className="mb-4 flex flex-col gap-2">{rooms.map((r) => <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl border border-ink/20 p-3"><div className="min-w-0"><p className="break-words font-bold">#{r.name}</p><p className="text-xs text-ink-muted">{r.isPrivate ? "Private" : "Public"} · {r.memberCount} members</p></div><div className="flex shrink-0 gap-1"><Button size="sm" disabled={busy} onClick={() => { setChannel(r.id); setStatus(""); setSearch(""); }}>Members</Button><Button size="sm" disabled={busy} onClick={() => setEditingChannel(editingChannel === r.id ? "" : r.id)}>Access</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleting(r)}>Delete</Button></div></li>)}</ul>
          {editingChannel && <div className="rounded-xl bg-surface p-3">
            <h4 className="mb-2 font-bold">Members of #{rooms.find((r) => r.id === editingChannel)?.name}</h4>
            <p className="mb-2 text-xs text-ink-muted">Private channels are visible only to selected members. Public channels can be rejoined by any community member.</p>
            <ul className="flex flex-col gap-2">{members.filter((m) => m.status === "active").map((m) => <li key={m.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm">{m.displayName}</span>
              <Button size="sm" disabled={busy} onClick={() => void act(() => api.channelMember(communityId, editingChannel, m.id, !m.roomIds.includes(editingChannel)), "Channel access updated.")}>{m.roomIds.includes(editingChannel) ? "Remove" : "Add"}</Button>
            </li>)}</ul>
          </div>}
        </section>
      </div>}
    </Dialog>
    <ConfirmDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={`Delete #${deleting?.name ?? ""}?`} description="This permanently deletes the channel, its messages and threads for everyone." confirmLabel="Delete channel" busy={busy} onConfirm={() => {
      if (deleting) void act(async () => { await api.deleteRoom(communityId, deleting.id); setDeleting(null); setChannel(""); }, "Channel deleted.");
    }} />
  </>;
}
