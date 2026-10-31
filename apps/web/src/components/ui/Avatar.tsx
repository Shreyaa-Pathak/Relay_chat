import type { AvatarColor } from "@relay/shared";
import { cx } from "./cx";

const bg: Record<AvatarColor, string> = {
  lavender: "bg-lavender",
  amber: "bg-amber",
  green: "bg-mint",
  blush: "bg-blush",
};

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export interface AvatarProps {
  name: string;
  color: AvatarColor;
  size?: "sm" | "md";
  online?: boolean;
  className?: string;
}

export function Avatar({ name, color, size = "md", online, className }: AvatarProps) {
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cx(
          "inline-flex items-center justify-center rounded-full border-2 border-ink font-bold text-ink",
          bg[color],
          size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs",
        )}
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          className={cx(
            "absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-paper",
            online ? "bg-mint-strong" : "bg-surface",
          )}
          title={online ? "Online" : "Offline"}
        >
          <span className="sr-only">{online ? "Online" : "Offline"}</span>
        </span>
      )}
    </span>
  );
}
