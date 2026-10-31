import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import type { Me } from "@relay/shared";
import { ChatController } from "../../state/controller";
import { toast, useChat } from "../../state/store";
import { Button } from "../../components/ui/Button";
import { Toasts } from "../../components/ui/Toasts";
import { cx } from "../../components/ui/cx";
import { useAuth } from "../auth/AuthContext";
import { ChatCtx, useController } from "./ChatContext";
import { Sidebar } from "./Sidebar";
import { ChannelView } from "./ChannelView";

export function ChatShell({ me }: { me: Me }) {
  const { sessionLost } = useAuth();
  const ref = useRef<ChatController | null>(null);
  const [ctl, setCtl] = useState<ChatController | null>(null);

  useEffect(() => {
    const c = new ChatController(me, {
      onSignedOut: () => {
        toast("Your session ended. Sign in again.", "info");
        sessionLost();
      },
    });
    ref.current = c;
    setCtl(c);
    void c.start();
    return () => c.stop("leave");
  }, [me, sessionLost]);

  if (!ctl) return null;
  return (
    <ChatCtx.Provider value={ctl}>
      <ChatLayout />
      <Toasts />
    </ChatCtx.Provider>
  );
}

function ChatLayout() {
  const { slug } = useParams();
  const ctl = useController();
  const rooms = useChat((s) => s.rooms);
  const roomsState = useChat((s) => s.roomsState);
  const [menuOpen, setMenuOpen] = useState(false);
  const room = rooms.find((r) => r.slug === slug);

  useEffect(() => {
    ctl.setActiveRoom(room?.isMember ? room.id : null);
  }, [ctl, room?.id, room?.isMember]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-mint focus:px-4 focus:py-2">
        Skip to messages
      </a>
      {/* Desktop sidebar; on mobile it's a drawer. */}
      <div
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[280px] transition-transform md:static md:z-auto md:translate-x-0",
          menuOpen ? "translate-x-0 shadow-sticker" : "-translate-x-full",
        )}
        aria-hidden={!menuOpen ? undefined : false}
      >
        <Sidebar activeSlug={slug} onNavigate={() => setMenuOpen(false)} />
      </div>
      {menuOpen && <button aria-label="Close channel list" className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={() => setMenuOpen(false)} />}
      <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!roomsState.loaded ? (
          roomsState.error ? (
            <CenterMessage title="Couldn't load channels" body={roomsState.error} action={<Button variant="primary" onClick={() => void ctl.loadRooms()}>Try again</Button>} />
          ) : (
            <CenterMessage title="Loading channels…" />
          )
        ) : !room ? (
          slug ? (
            <CenterMessage title={`#${slug} doesn't exist`} body="It may have been renamed or it's private." action={<Link className="font-bold underline" to="/c/general">Go to #general</Link>} />
          ) : (
            <Navigate to="/c/general" replace />
          )
        ) : !room.isMember ? (
          <CenterMessage
            title={`You're not in #${room.name}`}
            body={room.topic ?? undefined}
            action={
              <Button variant="primary" onClick={() => void ctl.join(room.id).catch((e) => toast((e as Error).message, "error"))}>
                Join #{room.name}
              </Button>
            }
          />
        ) : (
          <ChannelView key={room.id} room={room} onOpenMenu={() => setMenuOpen(true)} />
        )}
      </main>
    </div>
  );
}

function CenterMessage({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-2xl font-extrabold tracking-tight">{title}</p>
      {body && <p className="text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
