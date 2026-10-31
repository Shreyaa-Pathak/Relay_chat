import { cx } from "./ui/cx";

/** The Relay wordmark: heavy, tight, set in the brand face. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cx("block font-extrabold tracking-[-0.06em] leading-none", className)}>Relay</span>;
}
