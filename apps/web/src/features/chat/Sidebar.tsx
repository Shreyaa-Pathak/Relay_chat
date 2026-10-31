import { useNavigate } from "react-router";
import { useState } from "react";
import { ChevronDown, Compass, Globe, LogOut, Plus, Settings, UserPlus } from "lucide-react";
import { useChat } from "../../state/store";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { ChannelItem } from "../../components/ui/ChannelItem";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { ConnectionStatus } from "../../components/ui/ConnectionStatus";
import { cx } from "../../components/ui/cx";
import { Wordmark } from "../../components/Wordmark";
import { useAuth } from "../auth/AuthContext";
import { BrowseChannelsDialog } from "./Dialogs";
import { AdminDialog } from "./AdminDialog";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { InvitePeopleDialog } from "./InvitePeopleDialog";
import { CommunitiesDialog } from "./CommunitiesDialog";
import { channelPath, communityPath } from "../../lib/paths";

export function Sidebar({ communityId, activeSlug, onNavigate }: { communityId: string | undefined; activeSlug: string | undefined; onNavigate?: () => void }) {
  const rooms = useChat((s) => s.rooms);
  const communities = useChat((s) => s.communities);
  const community = communities.find((c) => c.id === communityId);
  const isOwner = community?.role === "owner";
  const navigate = useNavigate();
  const roomsState = useChat((s) => s.roomsState);
  const unread = useChat((s) => s.unread);
  const me = useChat((s) => s.me);
  const conn = useChat((s) => s.conn);
  const { signOut } = useAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [ownerDialog, setOwnerDialog] = useState<"admin" | "create" | "invite" | "discover" | "superadmin" | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const isSuperadmin = me?.role === "superadmin";
  const hasAdminTools = isSuperadmin || (isOwner && !!communityId);
  const mine = rooms.filter((r) => r.isMember && r.communityId === communityId);

  return (
    <nav aria-label="Channels" className="flex h-full flex-col overflow-y-auto bg-surface px-3 pt-5 pb-3">
      <Wordmark className="mb-5 px-3 text-3xl" />
      <label className="sr-only" htmlFor="community-switcher">Community</label>
      <div className="mb-5 flex items-center gap-1">
        <select id="community-switcher" value={communityId ?? ""} className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-paper px-3 py-2 text-sm font-semibold" onChange={(e) => { const selected = communities.find((c) => c.id === e.target.value); if (selected) { navigate(communityPath(selected.slug)); onNavigate?.(); } }}>
          {!communityId && <option value="">Choose a community</option>}
          {communities.filter((c) => c.isMember).map((c) => <option key={c.id} value={c.id}>{c.name}{c.role === "owner" ? " (owner)" : ""}</option>)}
        </select>
        <Button variant="ghost" size="icon" aria-label="Discover communities" title="Discover communities" onClick={() => setOwnerDialog("discover")}>
          <Globe size={17} aria-hidden />
        </Button>
      </div>
      <div className="mb-2 flex items-center justify-between pl-3">
        <h2 className="text-sm font-semibold text-ink-muted">Channels</h2>
        <div className="flex">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Browse channels" title="Browse channels" onClick={() => setBrowse(true)}>
            <Compass size={16} aria-hidden />
          </Button>
          {isOwner && communityId && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Create channel" title="Create channel" onClick={() => setOwnerDialog("create")}>
            <Plus size={16} aria-hidden />
          </Button>}
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {mine.map((r) => (
          <li key={r.id}>
            <ChannelItem name={r.name} to={channelPath(community!.slug, r.slug)} active={r.slug === activeSlug} unread={unread[r.id]} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      {roomsState.error && (
        <p role="alert" className="mt-2 px-3 text-sm">
          Couldn't load channels. {roomsState.error}
        </p>
      )}
      {roomsState.loaded && mine.length === 0 && <p className="px-3 text-sm text-ink-muted">You haven't joined any channels.</p>}
      <div className="mt-auto flex flex-col gap-2 pt-6">
        {hasAdminTools && <div>
          <Button variant="ghost" size="sm" className="w-full" aria-expanded={adminOpen} aria-controls="admin-tools" onClick={() => setAdminOpen((o) => !o)}>
            <Settings size={16} aria-hidden /> Admin tools
            <ChevronDown size={16} aria-hidden className={cx("ml-auto transition-transform", adminOpen && "rotate-180")} />
          </Button>
          {adminOpen && <div id="admin-tools" className="mt-1 flex flex-col gap-0.5 border-l-2 border-ink/15 ml-5 pl-1">
            {isOwner && communityId && <>
              <Button variant="ghost" size="sm" onClick={() => setOwnerDialog("invite")}><UserPlus size={16} aria-hidden /> Invite people</Button>
              <Button variant="ghost" size="sm" onClick={() => setOwnerDialog("admin")}>Members and channels</Button>
            </>}
            {isSuperadmin && <Button variant="ghost" size="sm" onClick={() => setOwnerDialog("superadmin")}>Manage communities</Button>}
          </div>}
        </div>}
        {/* Visible only when something's wrong; the avatar's online dot covers the happy path. */}
        <div className={conn.status === "open" ? "sr-only" : "px-3"}>
          <ConnectionStatus status={conn.status} nextRetryAt={conn.nextRetryAt} />
        </div>
        {me && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-paper px-3 py-2">
            <Avatar name={me.displayName} color={me.avatarColor} online={conn.status === "open"} />
            <div className="min-w-0 flex-1" title={me.email}>
              <p className="truncate text-sm font-bold">{me.displayName}</p>
              <p className="truncate text-xs text-ink-muted">{isSuperadmin ? "Superadmin" : me.email}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => setConfirmOut(true)}>
              <LogOut size={17} />
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Sign out of Relay?"
        description="Messages that haven't been sent yet will be discarded on this device."
        confirmLabel="Sign out"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          await signOut();
        }}
      />
      {communityId && <BrowseChannelsDialog communityId={communityId} open={browse} onOpenChange={setBrowse} />}
      {ownerDialog === "discover" && <CommunitiesDialog open onOpenChange={(open) => { if (!open) setOwnerDialog(null); }} />}
      {isSuperadmin && ownerDialog === "superadmin" && <CommunitiesDialog superadmin open onOpenChange={(open) => { if (!open) setOwnerDialog(null); }} />}
      {isOwner && communityId && <>
        {ownerDialog === "admin" && <AdminDialog communityId={communityId} open onOpenChange={(open) => { if (!open) setOwnerDialog(null); }} />}
        {ownerDialog === "create" && <CreateChannelDialog communityId={communityId} open onOpenChange={(open) => { if (!open) setOwnerDialog(null); }} onCreated={onNavigate} />}
        {ownerDialog === "invite" && <InvitePeopleDialog communityId={communityId} open onOpenChange={(open) => { if (!open) setOwnerDialog(null); }} />}
      </>}
    </nav>
  );
}
