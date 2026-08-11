"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Mail } from "lucide-react";
import { subscribeToShop, type SubscribeState } from "@/lib/actions/subscribe";

/**
 * Where a visitor joins the shop's list.
 *
 * The card a shop's own page carries, and the body of the shareable
 * `/[handle]/subscribe` page — one component, because the two must ask for
 * the same thing in the same words. A signup form that differs between the
 * page a seller links from their bio and the page their customers browse is
 * two forms to keep truthful.
 *
 * The name field is optional and second. Every field added to a signup form
 * costs conversions, and the address is the only one the feature cannot work
 * without; the name buys a greeting, which is worth one optional box and not
 * a required one.
 */

export type SubscribeLabels = {
  title: string;
  body: string;
  emailLabel: string;
  nameLabel: string;
  cta: string;
  checkInbox: string;
  privacyNote: string;
  optional: string;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg focus-ring inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

export function SubscribeCard({
  handle,
  labels,
  /** The seller's offer for the address — shown only when they made one. */
  incentive,
  /** The standalone page is the page; the card on a storefront is an aside. */
  standalone = false,
}: {
  handle: string;
  labels: SubscribeLabels;
  incentive?: string | null;
  standalone?: boolean;
}) {
  const [state, formAction] = useActionState<SubscribeState, FormData>(
    subscribeToShop,
    { done: false },
  );

  /*
   * One answer for every outcome the server can reach, because the server
   * deliberately does not know which one it is in: already subscribed, never
   * seen, or blocked all end here. The only thing that replaces this is a
   * local failure — a malformed address, or our own transport falling over.
   */
  if (state.done) {
    return (
      <div
        role="status"
        className="surface-card flex items-start gap-3 rounded-2xl p-5 text-start"
      >
        <span className="accent-bg mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
          <Check className="size-4" />
        </span>
        <p className="text-sm leading-relaxed">{labels.checkInbox}</p>
      </div>
    );
  }

  const Heading = standalone ? "h1" : "h2";

  return (
    <section
      className={
        standalone
          ? "text-start"
          : "surface-card mt-12 rounded-2xl p-5 text-start sm:p-6"
      }
      aria-labelledby="subscribe-title"
    >
      <div className="flex items-center gap-2">
        {standalone ? null : <Mail className="size-4 shrink-0 opacity-60" aria-hidden />}
        <Heading
          id="subscribe-title"
          className={standalone ? "text-xl font-bold" : "text-base font-semibold"}
        >
          {labels.title}
        </Heading>
      </div>

      <p className="text-muted mt-1.5 text-sm leading-relaxed">{labels.body}</p>

      {incentive ? (
        <p className="mt-2 text-sm font-semibold">{incentive}</p>
      ) : null}

      <form action={formAction} className="mt-4">
        <input type="hidden" name="handle" value={handle} />

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="subscribe-email" className="sr-only">
              {labels.emailLabel}
            </label>
            <input
              id="subscribe-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder={labels.emailLabel}
              maxLength={254}
              aria-invalid={state.error ? true : undefined}
              className="surface-elevated focus-ring-accent h-11 w-full rounded-xl px-3.5 text-sm outline-none placeholder:opacity-50"
            />
          </div>
          <Submit label={labels.cta} />
        </div>

        <label htmlFor="subscribe-name" className="sr-only">
          {labels.nameLabel}
        </label>
        <input
          id="subscribe-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder={`${labels.nameLabel} — ${labels.optional}`}
          maxLength={60}
          className="surface-elevated focus-ring-accent mt-2 h-11 w-full rounded-xl px-3.5 text-sm outline-none placeholder:opacity-50"
        />

        {state.error ? (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        {/* Under the button, where it is read before the address is typed and
            not after — the promise is what makes typing it reasonable. */}
        <p className="text-muted mt-3 text-xs leading-relaxed">
          {labels.privacyNote}
        </p>
      </form>
    </section>
  );
}
