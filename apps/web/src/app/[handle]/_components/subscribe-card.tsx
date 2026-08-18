"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Mail } from "lucide-react";
import { markSubscribed } from "@sailo/customers/subscribe-prompt";
import { subscribeToShop, type SubscribeState } from "@/lib/actions/subscribe";

/**
 * Where a visitor joins the shop's list.
 *
 * The card a shop's own page carries, and the body of the shareable
 * `/[handle]/subscribe` page — one component, because the two must ask for
 * the same thing in the same words. A signup form that differs between the
 * page a seller links from their bio and the page their customers browse is
 * two forms to keep truthful. `subscribe-popup.tsx` is the third surface and
 * borrows `SubscribeForm` below for the same reason.
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

/**
 * The id the popup looks for.
 *
 * Exported rather than typed twice: the popup holds its peace while this card
 * is on screen, which is a coupling of exactly one string and is far cheaper
 * than a context threaded through a server component for two clients that
 * never otherwise speak.
 */
export const SUBSCRIBE_CARD_ID = "subscribe-card";

function Submit({ label, full }: { label: string; full?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`accent-bg focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-60 ${
        full ? "w-full" : "shrink-0"
      }`}
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

/**
 * The fields, the action, and the one answer the server gives.
 *
 * Owns its own `useActionState` rather than taking one, so each surface's
 * form is independent: a popup dismissed mid-type must not leave the card
 * under it showing an error about an address the visitor typed somewhere
 * else.
 */
export function SubscribeForm({
  handle,
  /** Only so a successful signup can quiet the popup on this device. */
  shopId,
  labels,
  idPrefix,
  /**
   * One field per line, at every width.
   *
   * The card is as wide as the page and puts the address and the button on
   * one line above `sm`. The popup is a 22rem column at that same width, and
   * a row inside it leaves an email field too narrow to read a typo back in.
   */
  stacked = false,
  /** Called once when the server has taken the address — the popup's cue. */
  onDone,
}: {
  handle: string;
  shopId?: string;
  labels: SubscribeLabels;
  idPrefix: string;
  stacked?: boolean;
  onDone?: () => void;
}) {
  const [state, formAction] = useActionState<SubscribeState, FormData>(
    subscribeToShop,
    { done: false },
  );

  /*
   * Recorded on submission and not on confirmation, because this browser is
   * usually not where the confirmation link gets clicked — that happens in a
   * mail app, often on a different device. Waiting for it would mean the
   * popup went on asking somebody who had already done what it asked.
   */
  useEffect(() => {
    if (!state.done) return;
    if (shopId) markSubscribed(shopId);
    onDone?.();
  }, [state.done, shopId, onDone]);

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
        className="surface-elevated mt-4 flex items-start gap-3 rounded-xl p-4 text-start"
      >
        <span className="accent-bg mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full">
          <Check className="size-4" />
        </span>
        <p className="text-sm leading-relaxed">{labels.checkInbox}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="handle" value={handle} />

      <div className={stacked ? "flex flex-col gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        <div className="flex-1">
          <label htmlFor={`${idPrefix}-email`} className="sr-only">
            {labels.emailLabel}
          </label>
          <input
            id={`${idPrefix}-email`}
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
        <Submit label={labels.cta} full={stacked} />
      </div>

      <label htmlFor={`${idPrefix}-name`} className="sr-only">
        {labels.nameLabel}
      </label>
      <input
        id={`${idPrefix}-name`}
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
  );
}

export function SubscribeCard({
  handle,
  shopId,
  labels,
  /** The seller's offer for the address — shown only when they made one. */
  incentive,
  /** The standalone page is the page; the card on a storefront is an aside. */
  standalone = false,
}: {
  handle: string;
  shopId?: string;
  labels: SubscribeLabels;
  incentive?: string | null;
  standalone?: boolean;
}) {
  const Heading = standalone ? "h1" : "h2";

  return (
    <section
      id={SUBSCRIBE_CARD_ID}
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

      <SubscribeForm
        handle={handle}
        shopId={shopId}
        labels={labels}
        idPrefix="subscribe"
      />
    </section>
  );
}
