import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Buttons, and the tone and size scales they are built from. */


type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "ghost"
  | "subtle"
  | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-ink-900 text-white shadow-xs hover:bg-ink-800 active:bg-ink-950 disabled:bg-ink-300",
  brand:
    "bg-brand-700 text-white shadow-xs hover:bg-brand-600 active:bg-brand-800 disabled:bg-brand-700/40",
  secondary:
    "border border-ink-200 bg-white text-ink-900 shadow-xs hover:border-ink-300 hover:bg-ink-50 active:bg-ink-100",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200",
  subtle: "bg-ink-100 text-ink-800 hover:bg-ink-200 active:bg-ink-300",
  danger:
    "bg-red-600 text-white shadow-xs hover:bg-red-700 active:bg-red-800 disabled:bg-red-300",
};

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-[0.9375rem]",
  icon: "size-10 gap-0",
  "icon-sm": "size-8 gap-0",
} as const;

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: keyof typeof BUTTON_SIZES;
  /** Swaps the leading slot for a spinner and blocks re-submission. */
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "focus-ring press inline-flex shrink-0 items-center justify-center rounded-xl font-medium",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
        "disabled:pointer-events-none disabled:opacity-60",
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
      {children}
    </button>
  );
}
