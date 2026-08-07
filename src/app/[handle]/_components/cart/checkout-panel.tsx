"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { createOrderIntent } from "@/lib/actions/orders";
import type { OrderIntentResult } from "@/lib/orders/types";
import { useCheckoutQuote } from "./use-checkout-quote";
import { PAYMENT_METHOD_DEFS, type PaymentMethodType } from "@/lib/payments";
import { formatPercent } from "@/lib/pricing";
import { readReferralCode } from "@/lib/referral";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";
import { deliveryCopy, railCopy } from "./checkout-copy";
import { useCart } from "./cart-provider";
import { Confirmation } from "./confirmation";
import type { CheckoutDelivery, CheckoutMethod, CheckoutPanelProps } from "./checkout.types";

export function CheckoutPanel({
  shopId,
  shopName,
  currency,
  items,
  methods,
  deliveryOptions,
  contactEmail,
  hasFiles = false,
  heldUntilPaid = false,
  title,
  ariaLabel,
  t,
  onClose,
  onPlaced,
  children,
  empty,
}: CheckoutPanelProps) {
  /*
   * Always rendered inside `CartRegion`, which is what puts the shop's
   * resolved locale in context — the same one the page is written in, so a
   * total reads `12,50 €` on a French storefront and `€12.50` on an English
   * one. Optional-chained because the buy-now sheet mounts this outside a
   * populated cart; the formatter falls back to English on its own.
   */
  const locale = useCart()?.locale;
  const [method, setMethod] = useState<PaymentMethodType>(
    methods[0]?.type ?? "whatsapp",
  );
  const [deliveryId, setDeliveryId] = useState<string | null>(
    deliveryOptions[0]?.id ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<
    OrderIntentResult,
    { ok: true }
  > | null>(null);

  /*
   * Every figure on this panel comes from the server. `useCheckoutQuote` owns
   * that conversation — the debounced re-price, the coupon round trip, and the
   * two questions only the server can answer about whether this basket needs
   * delivering or an address at all.
   */
  const quote = useCheckoutQuote({ shopId, items, deliveryId });
  const { preview, coupon, dispatchCoupon, totals, tax } = quote;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const def = PAYMENT_METHOD_DEFS[method];
  const rail = railCopy(method, t);
  const needsContact = Boolean(def.requires.contact);
  const needsEmail = Boolean(def.requires.email);
  const selectedDelivery = deliveryOptions.find((d) => d.id === deliveryId);
  // The server decides both of these: a basket of downloads isn't shipped, and
  // a collection order has nowhere to deliver to.
  const showDelivery = quote.needsDelivery && deliveryOptions.length > 0;
  const needsAddress = quote.needsAddress;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const res = await createOrderIntent({
      shopId,
      items,
      paymentMethod: method,
      deliveryMethodId: deliveryId ?? undefined,
      couponCode: quote.couponCode,
      affiliateCode: readReferralCode() ?? undefined,
      customerName: String(data.get("customerName") ?? ""),
      customerEmail: String(data.get("customerEmail") ?? ""),
      customerPhone: String(data.get("customerPhone") ?? ""),
      addressLine1: String(data.get("addressLine1") ?? ""),
      addressLine2: String(data.get("addressLine2") ?? ""),
      city: String(data.get("city") ?? ""),
      region: String(data.get("region") ?? ""),
      postalCode: String(data.get("postalCode") ?? ""),
      country: String(data.get("country") ?? ""),
      note: String(data.get("note") ?? ""),
    });

    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }

    // Emptied before any navigation: a card rail leaves the page immediately
    // and the buyer must not come back to a basket they've already paid for.
    onPlaced?.();

    /*
     * Two different things wear the same `redirect` kind, and they behave
     * nothing alike.
     *
     * `https:` — WhatsApp, Telegram, Instagram — genuinely leaves the page, so
     * returning early is right: nothing after it would ever run anyway.
     *
     * `mailto:` and `tel:` do not. They ask the operating system to hand off to
     * another app, and if nothing is registered to take it — desktop Chrome
     * with no default mail client, most commonly — the browser does nothing at
     * all. The page stays exactly where it was. Returning early there skipped
     * `setPending(false)`, so the button sat spinning forever while the order
     * had already been saved. A buyer reads that as failure and presses it
     * again, which is how one order becomes three.
     *
     * So: try the handoff either way, but only treat the http case as a
     * departure. Everything else falls through to the confirmation, because
     * the order exists whether or not a mail app ever opened.
     */
    if (res.handoff?.kind === "redirect") {
      const leavesPage = /^https?:/i.test(res.handoff.url);
      window.location.href = res.handoff.url;
      if (leavesPage) return;
    }

    setResult(res);
    setPending(false);
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <button
        type="button"
        aria-label={t.common.close}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      {/*
        Two things kept the close button out of reach on a phone, and they
        were independent — fixing either alone still left it unreachable.

        `dvh`, not `vh`. On iOS Safari `vh` is the *large* viewport, measured
        with the address bar hidden, and it does not change when the bar is
        showing. A panel capped at 92vh is therefore taller than the screen
        the buyer can actually see, and because the sheet is bottom-aligned
        below `sm`, the overflow goes off the *top* — taking the close button
        with it. `dvh` tracks the viewport that is really there.

        The panel no longer scrolls; the region inside it does. The button is
        positioned against the panel, so while the panel was the scrolling box
        it scrolled away with the content — reaching the payment fields meant
        pushing the X off screen. With `overflow-hidden` here and the scroller
        one level in, the button is pinned to a box that never moves.
      */}
      <div className="surface-card animate-rise relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="text-muted absolute end-4 top-4 z-10 transition hover:opacity-70"
        >
          <X className="size-5" />
        </button>

        {/*
          `overscroll-contain` stops the page behind the sheet from taking
          over the gesture once this reaches its end, which on iOS reads as
          the sheet refusing to scroll. The bottom padding clears the home
          indicator on a phone that has one.
        */}
        <div className="overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {result ? (
            <Confirmation
              result={result}
              shopName={shopName}
              contactEmail={contactEmail}
              methodName={rail.name}
              t={t}
              onClose={onClose}
            />
          ) : items.length === 0 ? (
            <div className="pe-8">{empty}</div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {children?.(preview)}

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              {showDelivery ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.howReceive}
                  </legend>
                  <div className="space-y-1.5">
                    {deliveryOptions.map((option) => {
                      const d = deliveryCopy(option.type, t);
                      const active = deliveryId === option.id;
                      const free =
                        option.freeOverCents !== null &&
                        totals.subtotalCents - totals.discountCents >=
                          option.freeOverCents;
                      return (
                        <label
                          key={option.id}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 transition ${
                            active ? "surface-elevated" : "hover:opacity-70"
                          }`}
                        >
                          <input
                            type="radio"
                            name="deliveryMethod"
                            value={option.id}
                            checked={active}
                            onChange={() => setDeliveryId(option.id)}
                            className="mt-0.5 size-4 accent-current"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-medium">
                                {option.name}
                              </span>
                              <span className="text-xs font-semibold tabular-nums">
                                {option.feeCents === 0 || free
                                  ? t.common.free
                                  : formatMoney(option.feeCents, currency, locale)}
                              </span>
                            </span>
                            <span className="text-muted block text-xs leading-snug">
                              {option.type === "collection"
                                ? (option.address ?? d.description)
                                : (option.estimate ?? d.description)}
                              {option.type === "collection" && option.hours
                                ? ` · ${option.hours}`
                                : ""}
                            </span>
                            {!free &&
                            option.freeOverCents !== null &&
                            option.feeCents > 0 ? (
                              <span className="text-muted block text-xs">
                                {interpolate(t.checkout.freeOver, {
                                  amount: formatMoney(
                                    option.freeOverCents,
                                    currency,
                                    locale,
                                  ),
                                })}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {methods.length > 1 ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.howOrder}
                  </legend>
                  <div className="space-y-1.5">
                    {methods.map((m) => {
                      const d = railCopy(m.type, t);
                      const active = method === m.type;
                      return (
                        <label
                          key={m.type}
                          className={`flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 transition ${
                            active ? "surface-elevated" : "hover:opacity-70"
                          }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={m.type}
                            checked={active}
                            onChange={() => setMethod(m.type)}
                            className="mt-0.5 size-4 accent-current"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {m.label ?? d.name}
                            </span>
                            <span className="text-muted block text-xs leading-snug">
                              {d.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <div className="space-y-2.5">
                <input
                  name="customerName"
                  placeholder={t.checkout.yourName}
                  autoComplete="name"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="customerEmail"
                    type="email"
                    // A card receipt has nowhere to go without one.
                    required={needsEmail}
                    placeholder={
                      needsContact || needsEmail
                        ? t.checkout.email
                        : t.checkout.emailOptional
                    }
                    autoComplete="email"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="customerPhone"
                    type="tel"
                    placeholder={needsContact ? t.checkout.phone : t.checkout.phoneOptional}
                    autoComplete="tel"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                </div>
                {needsContact ? (
                  <p className="text-muted text-xs">
                    {interpolate(t.checkout.contactHint, { shop: shopName })}
                  </p>
                ) : null}
              </div>

              {needsAddress ? (
                <fieldset className="space-y-2.5">
                  <legend className="mb-1.5 text-sm font-medium">
                    {t.checkout.deliveryAddress}
                  </legend>
                  <input
                    name="addressLine1"
                    placeholder={t.checkout.street}
                    autoComplete="address-line1"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="addressLine2"
                    placeholder={t.checkout.apartment}
                    autoComplete="address-line2"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="city"
                      placeholder={t.checkout.city}
                      autoComplete="address-level2"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                    <input
                      name="region"
                      placeholder={t.checkout.region}
                      autoComplete="address-level1"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      name="postalCode"
                      placeholder={t.checkout.postalCode}
                      autoComplete="postal-code"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                    <input
                      name="country"
                      placeholder={t.checkout.country}
                      autoComplete="country-name"
                      className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                    />
                  </div>
                </fieldset>
              ) : null}

              <textarea
                name="note"
                rows={2}
                placeholder={t.checkout.notes}
                className="surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50"
              />

              <div>
                {coupon.applied ? (
                  <div className="surface-elevated flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
                    <span className="text-sm">
                      <span className="font-semibold">{coupon.applied}</span>{" "}
                      <span className="text-muted">{t.checkout.applied}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => dispatchCoupon({ type: "cleared" })}
                      className="text-muted text-xs underline underline-offset-2 transition hover:opacity-70"
                    >
                      {t.checkout.remove}
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={coupon.input}
                      onChange={(e) => {
                        dispatchCoupon({ type: "typed", value: e.target.value.toUpperCase() });
                      }}
                      placeholder={t.checkout.discountCode}
                      aria-label={t.checkout.discountCode}
                      className="surface-elevated h-11 min-w-0 flex-1 rounded-xl px-3 text-sm uppercase outline-none placeholder:normal-case placeholder:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={quote.applyCoupon}
                      disabled={coupon.checking || !coupon.input.trim()}
                      className="surface-card h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition hover:opacity-70 disabled:opacity-40"
                    >
                      {coupon.checking ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        t.checkout.apply
                      )}
                    </button>
                  </div>
                )}
                {coupon.error ? (
                  <p className="mt-1.5 text-xs text-red-600">{coupon.error}</p>
                ) : null}
              </div>

              <dl className="surface-border space-y-1.5 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">{t.checkout.subtotal}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(totals.subtotalCents, currency, locale)}
                  </dd>
                </div>
                {totals.discountCents > 0 ? (
                  <div className="flex justify-between text-emerald-600">
                    <dt>{t.checkout.discount}</dt>
                    <dd className="tabular-nums">
                      −{formatMoney(totals.discountCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                {showDelivery && selectedDelivery ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">{selectedDelivery.name}</dt>
                    <dd className="tabular-nums">
                      {totals.deliveryFeeCents === 0
                        ? t.common.free
                        : formatMoney(totals.deliveryFeeCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                {tax && totals.taxCents > 0 && !tax.inclusive ? (
                  <div className="flex justify-between">
                    <dt className="text-muted">
                      {tax.name} ({formatPercent(tax.rateBp)}%)
                    </dt>
                    <dd className="tabular-nums">
                      {formatMoney(totals.taxCents, currency, locale)}
                    </dd>
                  </div>
                ) : null}
                <div className="surface-border flex justify-between border-t pt-1.5 text-base font-semibold">
                  <dt>{t.checkout.total}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(totals.totalCents, currency, locale)}
                  </dd>
                </div>
                {tax && totals.taxCents > 0 && tax.inclusive ? (
                  <p className="text-muted text-xs">
                    {interpolate(t.checkout.taxIncluded, {
                      amount: formatMoney(totals.taxCents, currency, locale),
                      name: tax.name,
                      percent: formatPercent(tax.rateBp),
                    })}
                  </p>
                ) : null}
              </dl>

              {hasFiles && heldUntilPaid ? (
                <p className="surface-elevated flex items-start gap-2 rounded-xl p-3 text-xs">
                  <Download className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                  {interpolate(t.checkout.downloadAfterPayment, {
                    shop: shopName,
                  })}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={pending || !preview}
                className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {rail.action}
              </button>

              <p className="text-muted text-center text-xs">
                {def.kind === "contact"
                  ? t.checkout.contactHandoffNote
                  : t.checkout.manualNote}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export type { CheckoutDelivery, CheckoutMethod, CheckoutPanelProps };
export { railCopy };
