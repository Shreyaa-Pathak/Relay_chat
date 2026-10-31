import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../../lib/api";
import { communityPath } from "../../lib/paths";
import { Button } from "../../components/ui/Button";
import { useAuth } from "./AuthContext";

export function AcceptInvitationPage() {
  const { hash } = useLocation();
  const token = hash.slice(1);
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = /^[a-f0-9]{64}$/.test(token);

  async function accept() {
    if (busy || !valid) return;
    setBusy(true);
    setError("");
    try {
      const { community } = await api.acceptInvite(token);
      navigate(communityPath(community.slug), { replace: true });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-full items-center justify-center p-6">
    <section className="flex w-full max-w-md flex-col gap-4 rounded-3xl border-2 border-ink bg-paper p-6 shadow-sticker">
      <h1 className="text-2xl font-bold">Join a community</h1>
      <p className="text-sm text-ink-muted">Accept this invitation using the account it was created for. Invitation links expire after seven days and can be used once.</p>
      {state.status === "signedIn" && <p className="break-all text-sm">Signed in as {state.user.email}</p>}
      {!valid && <p role="alert">This invitation link is incomplete or invalid. Ask the owner for a new link.</p>}
      {error && <p role="alert" className="rounded-xl bg-blush p-3 text-sm">{error}</p>}
      <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void accept()}>Accept invitation</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>Use another account</Button>
      <Link to="/communities" className="text-center text-sm underline">Back to communities</Link>
    </section>
  </main>;
}
