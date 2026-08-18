"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";
import {
  subscribeToNewsletter,
  type NewsletterState,
} from "@/lib/actions/newsletter";
import type { BlogDictionary } from "@sailo/i18n/marketing/blog";
import type { NewsletterSource } from "@sailo/marketing/newsletter";
import { cn } from "@sailo/design-system/web/cn";

/**
 * Where a reader joins Sailo's list.
 *
 * One component for every surface that asks — the article sidebar, the break
 * halfway down a long post, the foot of the index — because a signup form that
 * differs between two places on the same site is two forms to keep truthful,
 * and the one nobody looks at is the one that stops working.
 *
 * **One field.** The address is the only thing the feature cannot work
 * without, and every extra box costs conversions. The shop-side card asks for
 * a first name because a seller greeting a customer by name is worth an
 * optional field; a fortnightly newsletter addressed to "there" is not worth
 * the same trade.
 *
 * The layout prop is the only variation: `stacked` for the 18rem sidebar rail,
 * where an address field beside a button is too narrow to read a typo back in,
 * and inline everywhere the form has the width of the page.
 */

function Submit({ label, stacked }: { label: string; stacked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "focus-line inline-flex h-11 items-center justify-center gap-2 rounded-[var(--r-pill)] bg-[var(--ink)] px-5 text-sm font-medium text-[var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-60",
        stacked ? "w-full" : "shrink-0",
      )}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {label}
    </button>
  );
}

export function NewsletterForm({
  locale,
  b,
  source,
  /** The page this form is standing on — the attribution the list is built on. */
  path,
  stacked = false,
  className,
}: {
  locale: string;
  b: BlogDictionary;
  source: NewsletterSource;
  path?: string;
  stacked?: boolean;
  className?: string;
}) {
  const [state, formAction] = useActionState<NewsletterState, FormData>(
    subscribeToNewsletter,
    { done: false },
  );
  const id = useId();

  /*
   * One answer for every outcome the server can reach, because the server
   * deliberately does not know which one it is in: already subscribed, never
   * seen, or opted out all end here. The only thing that replaces this is a
   * local failure — a malformed address, or our own transport falling over.
   */
  if (state.done) {
    return (
      <div
        role="status"
        className={cn(
          "flex items-start gap-3 rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper-sunk)] p-4",
          className,
        )}
      >
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--paper)]"
        >
          <Check className="size-4" />
        </span>
        <p className="text-[0.875rem] leading-[1.6] text-[var(--ink)]">
          {b.subscribeDone}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className={className}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="source" value={source} />
      {path ? <input type="hidden" name="path" value={path} /> : null}

      <div className={cn("flex gap-2", stacked ? "flex-col" : "flex-col sm:flex-row")}>
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-email`} className="sr-only">
            {b.subscribeEmail}
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder={b.subscribeEmail}
            // `aria-describedby` and not a `title`: the note under the form is
            // the promise about what happens to the address, and a screen
            // reader should reach it from the field rather than by hunting.
            aria-describedby={`${id}-note`}
            /*
             * 16px and not the 15px the surrounding copy uses. Below 16px,
             * iOS Safari zooms the page when the field takes focus and does
             * not zoom back out — the visitor is left pinching their way out
             * of a page they were about to give their address to. It is a
             * floor rather than a preference, and `e2e/responsive.spec.ts`
             * enforces it across every public route.
             */
            className="focus-line h-11 w-full rounded-[var(--r-pill)] border border-[var(--mute-200)] bg-[var(--paper)] px-4 text-base text-[var(--ink)] placeholder:text-[var(--mute-400)]"
          />
        </div>
        <Submit label={b.subscribeCta} stacked={stacked} />
      </div>

      <p id={`${id}-note`} className="mt-3 text-[0.75rem] leading-[1.5] text-[var(--mute-400)]">
        {b.subscribeNote}
      </p>

      {state.error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
