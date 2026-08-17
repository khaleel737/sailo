"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  SHOP_CONSENT_EVENT,
  readShopConsent,
  writeShopConsent,
  type ShopConsentChoice,
} from "@sailo/customers/shop-consent";

export type ShopConsentLabels = {
  title: string;
  body: string;
  accept: string;
  decline: string;
  privacy: string;
  customise: string;
  save: string;
  essential: string;
  essentialBody: string;
  marketing: string;
  marketingBody: string;
};

/**
 * The consent request for a seller's tags, on that seller's storefront.
 *
 * A sibling of `cookie-consent.tsx`, not a reuse of it: that dialog asks
 * Sailo's question in Sailo's colours and writes to Sailo's store. This one
 * is on a page a seller owns — it wears the shop's accent and surface, its
 * categories describe the tools *this seller* configured, and the answer is
 * written under this shop's id so it follows the buyer to no other shop.
 *
 * The shape it keeps is the part that is law rather than taste: three ways
 * out of equal size, refusing exactly as easy as agreeing, a dialog beside
 * the content rather than a wall in front of it, and nothing loaded until an
 * answer exists. It is mounted only when the seller configured at least one
 * tag — a banner with nothing behind it would be us taxing their conversion
 * rate for a question with no subject.
 */
export function ShopConsent({
  shopId,
  labels,
  /** The configured tools by name, with what each stores — checkable, not prose. */
  disclosure,
}: {
  shopId: string;
  labels: ShopConsentLabels;
  disclosure: string[];
}) {
  /*
   * Whether this browser has answered is external state — another tab can
   * change it, and it cannot be read while rendering on the server, where the
   * answer must be "don't ask" or the banner flashes at people who already
   * answered. Identities are per-shop, so they live in `useCallback` keyed by
   * the id rather than at module scope like the Sailo banner's.
   */
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(SHOP_CONSENT_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(SHOP_CONSENT_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const isUnanswered = useCallback(
    () => readShopConsent(shopId) === null,
    [shopId],
  );
  const unanswered = useSyncExternalStore(subscribe, isUnanswered, () => false);

  // Closes the dialog even when storage refuses the write — a banner that
  // stays open under a clicked button reads as broken, not as private mode.
  const [dismissed, setDismissed] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const answer = useCallback(
    (choice: ShopConsentChoice) => {
      writeShopConsent(shopId, choice);
      setDismissed(true);
    },
    [shopId],
  );

  const accept = useCallback(() => answer("granted"), [answer]);
  const decline = useCallback(() => answer("denied"), [answer]);
  const openChoices = useCallback(() => setChoosing(true), []);
  const toggleMarketing = useCallback(() => setMarketing((on) => !on), []);
  const saveChoices = useCallback(
    () => answer(marketing ? "granted" : "denied"),
    [answer, marketing],
  );

  if (!unanswered || dismissed) return null;

  const categories = [
    {
      id: "essential" as const,
      label: labels.essential,
      body: labels.essentialBody,
      locked: true,
      // What a storefront keeps regardless of the answer: the language the
      // buyer picked, and this answer itself — which lives in localStorage,
      // qualified so the list stays a true statement about the device.
      stored: ["sailo_locale", "sailo_shop_consent (localStorage)"],
    },
    {
      id: "marketing" as const,
      label: labels.marketing,
      body: labels.marketingBody,
      locked: false,
      stored: disclosure,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="shop-consent-title"
      className="surface-card fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[34rem] rounded-2xl p-5 shadow-lg sm:inset-x-6 sm:bottom-6"
    >
      <p id="shop-consent-title" className="text-[0.9375rem] font-medium">
        {labels.title}
      </p>
      <p className="text-muted mt-1.5 text-[0.8125rem] leading-[1.65]">
        {labels.body}{" "}
        <Link
          href="/privacy"
          className="focus-ring-accent underline underline-offset-2 transition hover:opacity-70"
        >
          {labels.privacy}
        </Link>
      </p>

      {choosing ? (
        <ul className="mt-4 space-y-2">
          {categories.map((category) => {
            const on = category.locked || marketing;
            return (
              <li key={category.id}>
                <label
                  className={
                    category.locked
                      ? "surface-elevated flex items-start gap-3 rounded-xl p-3"
                      : "flex cursor-pointer items-start gap-3 rounded-xl p-3 transition hover:opacity-90"
                  }
                >
                  {/* The input carries the state, the keyboard behaviour and
                      the accessible name; the span beside it is only paint —
                      same construction as the Sailo banner's switch. */}
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={category.locked}
                    readOnly={category.locked}
                    onChange={category.locked ? undefined : toggleMarketing}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden
                    className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                      on ? "accent-bg" : "surface-elevated"
                    } ${category.locked ? "opacity-60" : "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--accent)]"}`}
                  >
                    {/* `rtl:-translate-x-4`: the track flips with the page
                        direction, the physical translate does not. */}
                    <span
                      className={`block size-4 rounded-full bg-[var(--surface-card)] shadow-sm transition-transform ${
                        on ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium">
                      {category.label}
                    </span>
                    <span className="text-muted block text-[0.75rem]">
                      {category.body}
                    </span>
                    {/* Names, not prose — identical in every language, and a
                        buyer who opens their storage can check them. */}
                    <span className="text-muted mt-1 block font-mono text-[0.6875rem] opacity-80">
                      {category.stored.join(", ")}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* Three ways out, equal size and shape. Only the accent tells accept
          apart — an accept louder than decline is the dark pattern with a
          legal name. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={accept}
          className="accent-bg focus-ring-accent inline-flex min-h-11 flex-1 basis-full items-center justify-center rounded-full px-5 text-[0.8125rem] font-semibold transition hover:opacity-90 sm:basis-0"
        >
          {labels.accept}
        </button>
        <button
          type="button"
          onClick={decline}
          className="surface-elevated focus-ring-accent inline-flex min-h-11 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full px-5 text-[0.8125rem] font-semibold transition hover:opacity-80 sm:basis-0"
        >
          {labels.decline}
        </button>
        <button
          type="button"
          onClick={choosing ? saveChoices : openChoices}
          aria-expanded={choosing}
          className="surface-elevated focus-ring-accent inline-flex min-h-11 flex-1 basis-[calc(50%-0.25rem)] items-center justify-center rounded-full px-5 text-[0.8125rem] font-semibold transition hover:opacity-80 sm:basis-0"
        >
          {choosing ? labels.save : labels.customise}
        </button>
      </div>
    </div>
  );
}
