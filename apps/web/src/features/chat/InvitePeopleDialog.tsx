import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";

const fieldClass = "w-full rounded-xl border-2 border-ink bg-paper px-3 py-2";

export function InvitePeopleDialog({ communityId, open, onOpenChange }: { communityId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [invitations, setInvitations] = useState<{ email: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [share, setShare] = useState<{ email: string; link: string } | null>(null);

  const load = useCallback(async () => {
    const result = await api.adminMembers(communityId);
    setInvitations(result.invitations);
    setLoaded(true);
  }, [communityId]);

  useEffect(() => {
    if (open) void load().catch((e: Error) => setError(e.message));
  }, [open, load]);

  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await load();
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email"));
    void act(async () => {
      await createInvitation(email);
      form.reset();
    }, "Invitation created. Share this private link with the invited person.");
  }

  async function createInvitation(email: string) {
    const { token } = await api.invite(communityId, email);
    setShare({ email, link: `${window.location.origin}/invite#${token}` });
  }

  async function copyLink() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      setNotice("Invitation link copied.");
    } catch {
      setError("Could not copy the link. Select and copy it from the field below.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite people" description="Invite someone to join this community." className="max-h-[90dvh] overflow-y-auto">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-muted">Share a private invitation link with the person you invite. They must sign in with the invited email and accept it. Links expire in seven days. Relay does not send email.</p>
        <form onSubmit={invite} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Email address
            <input name="email" type="email" required placeholder="member@example.com" className={fieldClass} />
          </label>
          <Button type="submit" variant="primary" loading={busy} className="self-start">Create invitation</Button>
        </form>
        {share && <div className="flex flex-col gap-2">
          <label htmlFor="invite-share-link" className="break-all text-sm font-semibold">Invitation link for {share.email}</label>
          <input id="invite-share-link" readOnly value={share.link} className={`${fieldClass} text-sm`} onFocus={(e) => e.target.select()} />
          <Button size="sm" className="self-start" onClick={() => void copyLink()}>Copy invitation link</Button>
          <p className="text-xs text-ink-muted">Copy before closing. Generating a new link replaces the previous one.</p>
        </div>}
        {error && <p role="alert" className="rounded-xl bg-blush p-3 text-sm">{error}</p>}
        {notice && <p role="status" className="rounded-xl bg-mint p-3 text-sm">{notice}</p>}
        <section aria-label="Pending invitations">
          <h3 className="mb-2 font-bold">Pending invitations</h3>
          {!loaded ? <div className="flex items-center gap-2"><p className="text-sm text-ink-muted">{error ? "Could not load invitations." : "Loading invitations..."}</p>{error && <Button size="sm" disabled={busy} onClick={() => void act(load, "Invitations refreshed.")}>Retry</Button>}</div>
            : invitations.length === 0 ? <p className="text-sm text-ink-muted">No pending invitations.</p>
              : <ul className="flex flex-col gap-2">{invitations.map((i) => (
                <li key={i.email} className="flex items-center justify-between gap-2 rounded-xl border border-ink/20 p-3">
                  <span className="min-w-0 break-all text-sm">{i.email}</span>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button size="sm" disabled={busy} onClick={() => void act(() => createInvitation(i.email), "New invitation link created. The previous link no longer works.")}>New link</Button>
                    <Button size="sm" disabled={busy} onClick={() => void act(async () => { await api.revokeInvite(communityId, i.email); if (share?.email === i.email) setShare(null); }, "Invitation revoked.")}>Revoke</Button>
                  </div>
                </li>
              ))}</ul>}
        </section>
      </div>
    </Dialog>
  );
}
