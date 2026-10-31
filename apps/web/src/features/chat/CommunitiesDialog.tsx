import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { Community, Me } from "@relay/shared";
import { api } from "../../lib/api";
import { communityPath } from "../../lib/paths";
import { useChat } from "../../state/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useController } from "./ChatContext";

const field = "w-full rounded-xl border-2 border-ink bg-paper px-3 py-2 text-sm";

export function CommunitiesDialog({ open, onOpenChange, superadmin = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; superadmin?: boolean;
}) {
  const ctl = useController();
  const navigate = useNavigate();
  const visible = useChat((s) => s.communities);
  const [all, setAll] = useState<Community[]>([]);
  const [accounts, setAccounts] = useState<Pick<Me, "id" | "email" | "displayName" | "role" | "status">[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!superadmin);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() {
    await ctl.loadRooms();
    if (superadmin) {
      const [communities, members] = await Promise.all([api.allCommunities(), api.platformMembers()]);
      setAll(communities.communities);
      setAccounts(members.members);
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (!superadmin) { void ctl.loadRooms(); return; }
    let cancelled = false;
    void Promise.all([api.allCommunities(), api.platformMembers()]).then(([communities, members]) => {
      if (!cancelled) { setAll(communities.communities); setAccounts(members.members); setLoaded(true); }
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, superadmin, ctl]);

  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try { await action(); await refresh(); setNotice(success); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    void act(async () => {
      await api.createCommunity({ name: String(data.get("name")), slug: String(data.get("slug")), description: String(data.get("description")), ownerEmail: String(data.get("ownerEmail")), isPrivate: data.get("private") === "on" });
      form.reset();
    }, "Community created with a general channel.");
  }

  const communities = superadmin ? all : visible;
  return <Dialog open={open} onOpenChange={onOpenChange} title={superadmin ? "Manage communities" : "Discover communities"}
    description={superadmin ? "Create communities and assign an owner for each one." : "Join a public community and start chatting immediately. Private communities are available by invitation."}
    className="max-h-[90dvh] w-[min(94vw,680px)] overflow-y-auto">
    <div className="flex flex-col gap-5">
      {error && <p role="alert" className="rounded-xl bg-blush p-3 text-sm">{error} <Button size="sm" disabled={busy} onClick={() => void act(async () => {}, "Refreshed.")}>Retry</Button></p>}
      {notice && <p role="status" className="rounded-xl bg-mint p-3 text-sm">{notice}</p>}
      {superadmin && <form onSubmit={create} className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
        <h3 className="font-bold">Create a community</h3>
        <label className="text-sm font-semibold">Business / community name<input className={field} name="name" required maxLength={40} placeholder="Community name" /></label>
        <label className="text-sm font-semibold">Slug<input className={field} name="slug" required maxLength={40} pattern="[a-z0-9][a-z0-9\-]{0,39}" placeholder="community-slug" /></label>
        <label className="text-sm font-semibold">Description<input className={field} name="description" maxLength={250} placeholder="What is this community about?" /></label>
        <label className="text-sm font-semibold">Owner email<input className={field} name="ownerEmail" type="email" required placeholder="An existing member's email" /></label>
        <label className="flex gap-2 text-sm"><input name="private" type="checkbox" />Private community — invitation only</label>
        <Button type="submit" variant="primary" loading={busy} className="self-start">Create community</Button>
      </form>}
      {!loaded ? <p>Loading communities...</p> : communities.length === 0 ? <p>No communities available yet.</p> : <ul className="flex flex-col gap-3">
        {communities.map((c) => <li key={c.id} className="rounded-2xl border border-ink/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><h3 className="break-words font-bold">{c.name}</h3><p className="text-xs text-ink-muted">{c.isPrivate ? "Private" : "Public"} · {c.memberCount} members{c.isSuspended ? " · Suspended" : ""}{c.role === "owner" ? " · You own this community" : ""}</p></div>
            <div className="flex gap-2">
              {!c.isSuspended && (c.isMember || !c.isPrivate) && <Button size="sm" disabled={busy} onClick={() => void act(async () => {
                if (!c.isMember) await api.joinCommunity(c.id);
                await ctl.loadRooms();
                onOpenChange(false);
                navigate(communityPath(c.slug));
              }, "Community joined.")}>{c.isMember ? "Open" : "Join"}</Button>}
              {superadmin && <Button size="sm" disabled={busy} onClick={() => void act(() => api.updateCommunity(c.id, { isSuspended: !c.isSuspended }), c.isSuspended ? "Community restored." : "Community suspended.")}>{c.isSuspended ? "Restore" : "Suspend"}</Button>}
            </div>
          </div>
          {c.description && <p className="mt-2 break-words text-sm text-ink-muted">{c.description}</p>}
          {superadmin && <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const ownerEmail = String(new FormData(form).get("ownerEmail"));
            void act(async () => { await api.updateCommunity(c.id, { ownerEmail }); form.reset(); }, "Community owner reassigned.");
          }}><input aria-label={`New owner email for ${c.name}`} type="email" name="ownerEmail" required placeholder="New owner email" className={`${field} min-w-0 flex-1`} /><Button size="sm" type="submit" disabled={busy}>Assign owner</Button></form>}
        </li>)}
      </ul>}
      {superadmin && loaded && <section aria-label="Platform accounts">
        <h3 className="mb-2 font-bold">Platform accounts</h3>
        <p className="mb-3 text-xs text-ink-muted">Suspending an account blocks access to every community. Community owners can block members only within their own community.</p>
        <ul className="flex flex-col gap-2">{accounts.map((u) => <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/20 p-3">
          <div className="min-w-0"><p className="break-words text-sm font-bold">{u.displayName} · {u.role}</p><p className="break-all text-xs text-ink-muted">{u.email} · {u.status}</p></div>
          {u.role !== "superadmin" && <Button size="sm" disabled={busy} onClick={() => void act(() => api.suspendAccount(u.id, u.status === "active" ? "blocked" : "active"), "Account access updated.")}>{u.status === "active" ? "Suspend account" : "Restore account"}</Button>}
        </li>)}</ul>
      </section>}
    </div>
  </Dialog>;
}
