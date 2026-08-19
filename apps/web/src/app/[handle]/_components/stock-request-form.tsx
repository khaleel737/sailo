"use client";

import { useId, useState, useTransition } from "react";
import { BellRing, Check } from "lucide-react";
import { requestStockAlert } from "@/lib/actions/stock-requests";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";

/**
 * "Tell me when it's back" — spec 33, where "Out of stock" used to be the end
 * of the page.
 *
 * The moment this exists for is the last blue medium selling on a Tuesday.
 * Today a seller's two options are to hide the product and lose everyone, or
 * leave it reading "out of stock" and lose the buyer who would happily have
 * waited eleven days. This is the third.
 *
 * ONE ANSWER, WHATEVER HAPPENED
 *
 * The action never reports whether a row was written, whether that contact was
 * already waiting, or whether the variant exists — a response that varied would
 * be a way to test which of a seller's variants are real and who is watching
 * them. So this component has exactly two end states: "you'll hear from us",
 * and "try again shortly" for the one case where nothing was written because
 * the ceiling failed closed. The second is not an answer about the product and
 * the copy says nothing about stock.
 *
 * WHAT IT SHOWS THE BUYER ABOUT OTHER BUYERS: NOTHING
 *
 * No "23 people waiting". That number is real and the seller sees it, but it is
 * a fact about their shop rather than about the person reading it, and a nudge
 * built out of somebody else's data is the thing spec 33 refuses by name.
 *
 * The phone field appears only where the shop actually runs a chat rail,
 * because Sailo does not send to a phone: the seller does, from their own
 * number, through the `wa.me` link on their own screen. Offering the field on a
 * card-only shop would be collecting a number nobody will ever use.
 */
export function StockRequestForm({
  shopId,
  productId,
  variantId,
  /** True where the shop runs a chat rail and a number is worth collecting. */
  takesPhone = false,
  locale,
  t,
}: {
  shopId: string;
  productId: string;
  variantId: string | null;
  takesPhone?: boolean;
  locale?: string;
  t: Dictionary;
}) {
  const id = useId();
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "done" | "unavailable">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "done") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
        <Check className="mt-0.5 size-4 shrink-0" />
        {/* Deliberately not "we've saved your details": that would be an answer
            about what was written, and the whole point is that there isn't one.
            It also does not promise the item is held — nothing is. */}
        {t.stock.queued}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const value = contact.trim();
        if (!value) return;

        startTransition(async () => {
          /*
           * Which field it is decided here rather than by a second input,
           * because a buyer typing into one box is one decision. An `@` is the
           * only thing that separates the two in practice, and the server
           * normalises both again — this only picks which argument to fill.
           */
          const looksLikeEmail = value.includes("@");
          const result = await requestStockAlert({
            shopId,
            productId,
            variantId,
            email: looksLikeEmail ? value : null,
            phone: looksLikeEmail ? null : value,
            locale,
          });
          setState(result.ok ? "done" : result.unavailable ? "unavailable" : "done");
        });
      }}
      className="space-y-2"
    >
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
        <BellRing className="size-4" />
        {t.stock.tellMe}
      </label>

      <div className="flex gap-2">
        <input
          id={id}
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          /*
           * `type="text"`, not `type="email"`, on a shop that also takes a
           * number: the browser would refuse a valid phone number as malformed
           * and the buyer would have no way to know why. Where only an address
           * is useful, the stricter type is the better keyboard and the better
           * validation.
           */
          type={takesPhone ? "text" : "email"}
          inputMode={takesPhone ? "text" : "email"}
          autoComplete={takesPhone ? "off" : "email"}
          required
          maxLength={200}
          placeholder={takesPhone ? t.stock.contactPlaceholder : t.stock.emailPlaceholder}
          className="surface-elevated h-12 w-full min-w-0 rounded-xl px-3 text-base outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="accent-bg h-12 shrink-0 rounded-xl px-4 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
        >
          {t.stock.notifyMe}
        </button>
      </div>

      {state === "unavailable" ? (
        /* Not an answer about the product. Nothing was written, and the copy
           says only that — a buyer told "you'll hear from us" when nothing was
           recorded is a buyer who waits for ever. */
        <p className="text-sm text-amber-700">{t.stock.tryAgain}</p>
      ) : (
        <p className="text-muted text-xs">
          {interpolate(t.stock.onceOnly, { shop: "" }).trim()}
        </p>
      )}
    </form>
  );
}
