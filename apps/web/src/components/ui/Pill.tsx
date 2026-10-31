import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "mint" | "outline" | "quiet";
}

/** Status / metric chip. "mint" uses the sticker outline; "outline" the dashed tech-tag style. */
export function Pill({ tone = "quiet", className, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full text-sm whitespace-nowrap",
        tone === "mint" && "bg-mint border-2 border-ink shadow-sticker-sm px-3 py-0.5 font-semibold",
        tone === "outline" && "border border-dashed border-ink px-3 py-0.5",
        tone === "quiet" && "bg-surface px-2.5 py-0.5 text-ink",
        className,
      )}
      {...rest}
    />
  );
}
