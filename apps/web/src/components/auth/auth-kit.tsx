import type { ReactNode } from "react";
import { Field, Input } from "@sailo/design-system/web";
import { cn } from "@sailo/design-system/web/cn";

/*
 * The four auth screens, dressed for the brand surface.
 *
 * These are thin wrappers, not a second form system. `Field` and `Input` in
 * `components/ui` stay the single source of truth for labels, hints, errors
 * and the invalid state; all that happens here is a change of clothes, passed
 * through `className` so `twMerge` drops the conflicting app-surface defaults.
 *
 * Why bother: the app surface is white cards on grey with a green focus ring.
 * The brand surface is bone paper, ink, and a capsule button. A sign-up form
 * that looks like the admin is a jarring handoff from the page that sold it.
 */

/** Page title and one line under it. Every auth screen opens with this. */
export function AuthHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-9">
      <h1 className="display-sm text-[1.75rem] text-[var(--ink)]">{title}</h1>
      {subtitle ? (
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--mute-500)]">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/** An input on the brand surface: taller, softer, ink focus instead of green. */
export function AuthInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-12 rounded-[14px] border-[var(--mute-200)] bg-white px-4 text-[0.9375rem] text-[var(--ink)] shadow-none",
        "placeholder:text-[var(--mute-300)]",
        "hover:border-[var(--mute-300)]",
        "focus:border-[var(--ink)] focus:ring-4 focus:ring-[var(--ink)]/8",
        className,
      )}
      {...props}
    />
  );
}

/** `Field`, minus the app surface's tighter label rhythm. */
export function AuthField({
  className,
  ...props
}: React.ComponentProps<typeof Field>) {
  return <Field className={cn("[&_label]:text-[var(--mute-600)]", className)} {...props} />;
}

/**
 * The submit button. A capsule in ink, matching every primary action on the
 * landing page, and full width because there is only ever one thing to do on
 * these screens.
 */
export function AuthSubmit({
  children,
  loading,
}: {
  children: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      aria-busy={loading || undefined}
      className={cn(
        "focus-line push mt-2 inline-flex h-12 w-full items-center justify-center gap-2.5",
        "rounded-[var(--r-pill)] bg-[var(--ink)] text-[0.9375rem] font-medium text-[var(--paper)]",
        "transition-colors hover:bg-[var(--ink-soft)]",
        "disabled:pointer-events-none disabled:opacity-55",
      )}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}

/** The one link under the form: the other account state, or the way back. */
export function AuthFooterLink({
  prompt,
  href,
  label,
}: {
  prompt?: string;
  href: string;
  label: string;
}) {
  return (
    <p className="pt-2 text-center text-[0.875rem] text-[var(--mute-500)]">
      {prompt ? `${prompt} ` : null}
      <a
        href={href}
        className="focus-line draw-underline font-medium text-[var(--ink)]"
      >
        {label}
      </a>
    </p>
  );
}

/** Inline error, above the fields it is about. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-[14px] border border-red-200 bg-red-50 px-4 py-3 text-[0.875rem] leading-relaxed text-red-800"
    >
      {children}
    </p>
  );
}

/** Positive confirmation, same shape as the error so nothing jumps. */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-[14px] border border-[var(--mute-200)] bg-[var(--paper-sunk)] px-4 py-3 text-[0.875rem] leading-relaxed text-[var(--mute-600)]"
    >
      {children}
    </p>
  );
}
