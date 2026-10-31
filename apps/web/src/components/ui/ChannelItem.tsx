import { Link } from "react-router";
import { cx } from "./cx";

export interface ChannelItemProps {
  name: string;
  to: string;
  active: boolean;
  unread?: number;
  onNavigate?: () => void;
}

export function ChannelItem({ name, to, active, unread = 0, onNavigate }: ChannelItemProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center justify-between rounded-full px-3 py-1.5 text-[15px] border-2",
        active ? "bg-mint border-ink shadow-sticker-sm font-semibold" : "border-transparent hover:bg-surface",
        !active && unread > 0 && "font-bold",
      )}
    >
      <span className="truncate">
        <span aria-hidden className="mr-1 opacity-70">#</span>
        {name}
      </span>
      {unread > 0 && !active && (
        <span className="ml-2 min-w-6 rounded-full bg-ink px-1.5 text-center text-xs font-bold text-paper">
          {unread > 99 ? "99+" : unread}
          <span className="sr-only"> unread</span>
        </span>
      )}
    </Link>
  );
}
