import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  // The "sticker" treatment: ink outline + hard offset shadow. Pressing removes the shadow.
  primary:
    "bg-mint text-ink border-2 border-ink shadow-sticker hover:bg-mint-strong active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  secondary: "bg-paper text-ink border-2 border-ink hover:bg-surface active:translate-y-px",
  ghost: "bg-transparent text-ink border-2 border-transparent hover:bg-surface",
  danger:
    "bg-blush text-ink border-2 border-ink shadow-sticker-sm hover:brightness-95 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-[15px] gap-2",
  lg: "h-12 px-6 text-base gap-2",
  icon: "h-10 w-10 justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center rounded-full font-semibold transition-[transform,box-shadow,background-color] duration-100 select-none",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
