import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../lib/api";
import { channelPath } from "../../lib/paths";
import { useChat } from "../../state/store";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { useController } from "./ChatContext";

const fieldClass = "w-full rounded-xl border-2 border-ink bg-paper px-3 py-2";

export function CreateChannelDialog({ communityId, open, onOpenChange, onCreated }: {
  communityId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const ctl = useController();
  const community = useChat((s) => s.communities.find((c) => c.id === communityId));
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !community) return;
    const data = new FormData(e.currentTarget);
    const slug = String(data.get("slug")).trim();
    setBusy(true);
    setError("");
    try {
      await api.createRoom(communityId, {
        name: String(data.get("name")),
        slug,
        topic: String(data.get("topic")),
        isPrivate: data.get("private") === "on",
      });
      await ctl.loadRooms();
      onOpenChange(false);
      onCreated?.();
      navigate(channelPath(community.slug, slug));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create a channel" description="Give your community a space for a new conversation." className="max-h-[90dvh] overflow-y-auto">
      <form onSubmit={(e) => void create(e)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Channel name
          <input name="name" required maxLength={40} placeholder="e.g. Product ideas" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Channel slug
          <input name="slug" required maxLength={40} pattern="[a-z0-9][a-z0-9\-]{0,39}" placeholder="e.g. product-ideas" aria-describedby="channel-slug-help" className={fieldClass} />
          <span id="channel-slug-help" className="text-xs font-normal text-ink-muted">Use lowercase letters, numbers and hyphens for the channel URL.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Topic (optional)
          <input name="topic" maxLength={250} placeholder="What will people discuss here?" className={fieldClass} />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input name="private" type="checkbox" className="mt-1" />
          <span>Private channel<span className="block text-xs text-ink-muted">Only you initially. Add members with Access in Members and channels.</span></span>
        </label>
        {error && <p role="alert" className="rounded-xl bg-blush p-3 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Create channel</Button>
        </div>
      </form>
    </Dialog>
  );
}
