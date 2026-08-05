"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileText,
  Gift,
  Loader2,
  X,
} from "lucide-react";
import {
  createOrderIntent,
  previewOrder,
  submitPaymentReference,
  type OrderIntentResult,
  type OrderLineInput,
  type OrderPreview,
  type PreviewTax,
} from "@/lib/actions/orders";
import { PAYMENT_METHOD_DEFS, type PaymentMethodType } from "@/lib/payments";
import type { DeliveryMethodType } from "@/lib/delivery";
import { formatPercent, type Totals } from "@/lib/pricing";
import { readReferralCode } from "@/lib/referral";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { formatMoney } from "@/lib/utils";

export type CheckoutMethod = {
  type: PaymentMethodType;
  label: string | null;
};

export type CheckoutDelivery = {
  id: string;
  type: DeliveryMethodType;
  name: string;
  feeCents: number;
  freeOverCents: number | null;
  estimate?: string;
  address?: string;
  hours?: string;
};

/**
 * Everything below the goods: how it arrives, how it's paid for, who to send
 * it to, and what it costs.
 *
 * One product or twenty, the questions are the same — so "buy now" and the
 * cart render this same panel and differ only in what they put above it.
 * Money and eligibility come from the server on every change, so the panel
 * never has to know the rules.
 */
export type CheckoutPanelProps = {
  shopId: string;
  shopName: string;
  currency: string;
  /** What's being bought. The server re-prices all of it. */
  items: OrderLineInput[];
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  contactEmail: string | null;
  /** True when a digital line has files attached. */
  hasFiles?: boolean;
  /** True when those files wait for the seller to confirm payment. */
  heldUntilPaid?: boolean;
  /** Short label for the sheet's header — "Order", "Your basket". */
  title: string;
  /** The fuller description a screen reader announces. */
  ariaLabel?: string;
  t: Dictionary;
  onClose: () => void;
  /** Fires once the order is placed, so a cart can empty itself. */
  onPlaced?: () => void;
  /** The goods: variant pickers, or the basket's lines. */
  children?: (preview: OrderPreview | null) => React.ReactNode;
  /** Shown instead of the form when there's nothing to buy. */
  empty?: React.ReactNode;
};

/**
 * Buyer-facing rail copy. `PAYMENT_METHOD_DEFS` is written for the seller
 * ("Buyer sees your account details…"), so the shopper gets these instead.
 */
export function railCopy(type: PaymentMethodType, t: Dictionary) {
  switch (type) {
    case "card":
      return { name: t.rails.cardName, action: t.rails.cardAction, description: t.rails.cardDesc };
    case "whatsapp":
      return { name: "WhatsApp", action: t.rails.whatsappAction, description: t.rails.whatsappDesc };
    case "telegram":
      return { name: "Telegram", action: t.rails.telegramAction, description: t.rails.telegramDesc };
    case "instagram":
      return { name: t.rails.instagramName, action: t.rails.instagramAction, description: t.rails.instagramDesc };
    case "email":
      return { name: t.rails.emailName, action: t.rails.emailAction, description: t.rails.emailDesc };
    case "phone":
      return { name: t.rails.phoneName, action: t.rails.phoneAction, description: t.rails.phoneDesc };
    case "bank_transfer":
      return { name: t.rails.bankName, action: t.rails.bankAction, description: t.rails.bankDesc };
    case "cod":
      return { name: t.rails.codName, action: t.rails.codAction, description: t.rails.codDesc };
  }
}

function deliveryCopy(type: DeliveryMethodType, t: Dictionary) {
  return type === "collection"
    ? { name: t.rails.collectionName, description: t.rails.collectionDesc }
    : { name: t.rails.shippingName, description: t.rails.shippingDesc };
}

const EMPTY_TOTALS: Totals = {
  subtotalCents: 0,
  discountCents: 0,
  deliveryFeeCents: 0,
  taxCents: 0,
  totalCents: 0,
  commissionCents: 0,
};

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
  const [method, setMethod] = useState<PaymentMethodType>(
    methods[0]?.type ?? "whatsapp",
  );
  const [deliveryId, setDeliveryId] = useState<string | null>(
    deliveryOptions[0]?.id ?? null,
  );
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<
    OrderIntentResult,
    { ok: true }
  > | null>(null);

  const totals = preview?.totals ?? EMPTY_TOTALS;
  const tax: PreviewTax = preview?.tax ?? null;

  // An array prop is a new object every render; the contents are what matter.
  const itemsKey = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Totals come from the server so the quote can't drift from what's charged.
  useEffect(() => {
    // Nothing to price — the empty state is showing instead of the form, so a
    // stale preview can't be seen.
    if (items.length === 0) return;
    let cancelled = false;
    previewOrder({
      shopId,
      items,
      deliveryMethodId: deliveryId ?? undefined,
      couponCode: appliedCoupon || undefined,
    }).then((res) => {
      if (cancelled || "error" in res) return;
      setPreview(res);
      // A code that was fine a moment ago can stop qualifying when the basket
      // shrinks below its minimum, so it's dropped rather than silently kept.
      if (appliedCoupon && res.couponError) {
        setCouponError(res.couponError);
        setAppliedCoupon("");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId, itemsKey, deliveryId, appliedCoupon]);

  async function onApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponError(null);

    const res = await previewOrder({
      shopId,
      items,
      deliveryMethodId: deliveryId ?? undefined,
      couponCode: code,
    });
    setCheckingCoupon(false);

    if ("error" in res) {
      setCouponError(res.error);
      return;
    }
    if (res.couponError) {
      setCouponError(res.couponError);
      return;
    }
    setAppliedCoupon(res.couponApplied ?? code.toUpperCase());
    setPreview(res);
  }

  const def = PAYMENT_METHOD_DEFS[method];
  const rail = railCopy(method, t);
  const needsContact = Boolean(def.requires.contact);
  const needsEmail = Boolean(def.requires.email);
  const selectedDelivery = deliveryOptions.find((d) => d.id === deliveryId);
  // The server decides both of these: a basket of downloads isn't shipped, and
  // a collection order has nowhere to deliver to.
  const showDelivery = (preview?.needsDelivery ?? false) && deliveryOptions.length > 0;
  const needsAddress = preview?.needsAddress ?? false;

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
      couponCode: appliedCoupon || undefined,
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

    // Contact rails leave the site immediately; manual rails stay for instructions.
    if (res.handoff?.kind === "redirect") {
      window.location.href = res.handoff.url;
      return;
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

      <div className="surface-card animate-rise relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="text-muted absolute end-4 top-4 z-10 transition hover:opacity-70"
        >
          <X className="size-5" />
        </button>

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
                                : formatMoney(option.feeCents, currency)}
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
              {appliedCoupon ? (
                <div className="surface-elevated flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
                  <span className="text-sm">
                    <span className="font-semibold">{appliedCoupon}</span>{" "}
                    <span className="text-muted">{t.checkout.applied}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedCoupon("");
                      setCouponInput("");
                      setCouponError(null);
                    }}
                    className="text-muted text-xs underline underline-offset-2 transition hover:opacity-70"
                  >
                    {t.checkout.remove}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value.toUpperCase());
                      setCouponError(null);
                    }}
                    placeholder={t.checkout.discountCode}
                    aria-label={t.checkout.discountCode}
                    className="surface-elevated h-11 min-w-0 flex-1 rounded-xl px-3 text-sm uppercase outline-none placeholder:normal-case placeholder:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={onApplyCoupon}
                    disabled={checkingCoupon || !couponInput.trim()}
                    className="surface-card h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition hover:opacity-70 disabled:opacity-40"
                  >
                    {checkingCoupon ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      t.checkout.apply
                    )}
                  </button>
                </div>
              )}
              {couponError ? (
                <p className="mt-1.5 text-xs text-red-600">{couponError}</p>
              ) : null}
            </div>

            <dl className="surface-border space-y-1.5 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t.checkout.subtotal}</dt>
                <dd className="tabular-nums">
                  {formatMoney(totals.subtotalCents, currency)}
                </dd>
              </div>
              {totals.discountCents > 0 ? (
                <div className="flex justify-between text-emerald-600">
                  <dt>{t.checkout.discount}</dt>
                  <dd className="tabular-nums">
                    −{formatMoney(totals.discountCents, currency)}
                  </dd>
                </div>
              ) : null}
              {showDelivery && selectedDelivery ? (
                <div className="flex justify-between">
                  <dt className="text-muted">{selectedDelivery.name}</dt>
                  <dd className="tabular-nums">
                    {totals.deliveryFeeCents === 0
                      ? t.common.free
                      : formatMoney(totals.deliveryFeeCents, currency)}
                  </dd>
                </div>
              ) : null}
              {tax && totals.taxCents > 0 && !tax.inclusive ? (
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {tax.name} ({formatPercent(tax.rateBp)}%)
                  </dt>
                  <dd className="tabular-nums">
                    {formatMoney(totals.taxCents, currency)}
                  </dd>
                </div>
              ) : null}
              <div className="surface-border flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>{t.checkout.total}</dt>
                <dd className="tabular-nums">
                  {formatMoney(totals.totalCents, currency)}
                </dd>
              </div>
              {tax && totals.taxCents > 0 && tax.inclusive ? (
                <p className="text-muted text-xs">
                  {interpolate(t.checkout.taxIncluded, {
                    amount: formatMoney(totals.taxCents, currency),
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
  );
}

function Confirmation({
  result,
  shopName,
  contactEmail,
  methodName,
  t,
  onClose,
}: {
  result: Extract<OrderIntentResult, { ok: true }>;
  shopName: string;
  contactEmail: string | null;
  methodName: string;
  t: Dictionary;
  onClose: () => void;
}) {
  const [reference, setReference] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const hasBank = Boolean(result.bankDetails?.length);

  async function onSubmitReference() {
    setPending(true);
    setRefError(null);
    const res = await submitPaymentReference({
      orderId: result.orderId,
      reference,
    });
    if (!res.ok) {
      setRefError(res.error ?? t.checkout.saveFailed);
      setPending(false);
      return;
    }
    setSubmitted(true);
    setPending(false);
  }

  async function copyDetails() {
    const text = (result.bankDetails ?? [])
      .map((d) => `${d.label}: ${d.value}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Details stay visible on screen, so a blocked clipboard is harmless.
    }
  }

  return (
    <div className="py-2">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <Check className="size-6" />
      </div>
      <p className="text-center font-semibold">
        {interpolate(t.checkout.orderSent, { shop: shopName })}
      </p>
      <p className="text-muted mt-1 text-center text-sm">
        {hasBank
          ? t.checkout.bankInstructions
          : interpolate(t.checkout.paidBy, { method: methodName })}
      </p>

      {hasBank ? (
        <div className="surface-elevated mt-4 rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide opacity-60">
              {t.checkout.bankDetails}
            </span>
            <button
              type="button"
              onClick={copyDetails}
              className="inline-flex items-center gap-1 text-xs font-medium transition hover:opacity-70"
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? t.checkout.copied : t.checkout.copy}
            </button>
          </div>
          <dl className="space-y-1.5">
            {result.bankDetails!.map((d) => (
              <div key={d.label} className="flex justify-between gap-3 text-sm">
                <dt className="text-muted shrink-0">{d.label}</dt>
                <dd className="text-end font-medium break-all">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {result.downloadUrl ? (
        <a
          href={result.downloadUrl}
          className="accent-bg mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90"
        >
          <Download className="size-4" />
          {t.checkout.getFiles}
        </a>
      ) : result.downloadPending ? (
        <p className="surface-elevated mt-4 flex items-start gap-2 rounded-xl p-3 text-sm">
          <Download className="mt-0.5 size-4 shrink-0 opacity-60" />
          {interpolate(t.checkout.downloadAfterPayment, { shop: shopName })}
        </p>
      ) : null}

      {result.instructions ? (
        <p className="surface-elevated mt-3 whitespace-pre-wrap rounded-xl p-3 text-sm">
          {result.instructions}
        </p>
      ) : null}

      {hasBank && !submitted ? (
        <div className="mt-4 space-y-2">
          {refError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {refError}
            </p>
          ) : null}
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t.checkout.transferReference}
            className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
          />
          <button
            type="button"
            onClick={onSubmitReference}
            disabled={pending || !reference.trim()}
            className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t.checkout.sentPayment}
          </button>
        </div>
      ) : null}

      {submitted ? (
        <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-sm text-emerald-700">
          {interpolate(t.checkout.confirmSoon, { shop: shopName })}
        </p>
      ) : null}

      {result.invoiceUrl ? (
        <a
          href={result.invoiceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="surface-card mt-4 flex items-center justify-between gap-3 rounded-xl p-3 transition hover:opacity-80"
        >
          <span className="flex items-center gap-2 text-sm">
            <FileText className="size-4 shrink-0 opacity-60" />
            {interpolate(t.checkout.invoice, {
              number: result.invoiceNumber ?? "",
            })}
          </span>
          <span className="text-muted text-xs">{t.checkout.view} · PDF</span>
        </a>
      ) : null}

      {result.referral ? (
        <ReferAndEarn referral={result.referral} shopName={shopName} t={t} />
      ) : null}

      {contactEmail ? (
        <p className="text-muted mt-3 text-center text-xs">
          {interpolate(t.checkout.questions, { email: contactEmail })}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="surface-elevated mt-4 h-10 w-full rounded-xl text-sm font-medium"
      >
        {t.common.done}
      </button>
    </div>
  );
}

/**
 * Shown right after ordering — the moment the buyer has most obviously just
 * decided the shop is worth buying from.
 */
function ReferAndEarn({
  referral,
  shopName,
  t,
}: {
  referral: { code: string; url: string; percent: string };
  shopName: string;
  t: Dictionary;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(referral.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen, so a blocked clipboard isn't fatal.
    }
  }

  return (
    <div className="surface-card mt-4 rounded-xl p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Gift className="size-4 shrink-0" />
        {interpolate(t.checkout.earnReferral, { percent: referral.percent })}
      </p>
      <p className="text-muted mt-1 text-xs leading-relaxed">
        {interpolate(t.checkout.earnReferralBody, {
          shop: shopName,
          percent: referral.percent,
        })}
      </p>
      <div className="surface-elevated mt-2.5 flex items-center gap-2 rounded-lg p-2">
        <code className="min-w-0 flex-1 truncate text-xs">{referral.url}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium transition hover:opacity-70"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t.checkout.copied : t.checkout.copy}
        </button>
      </div>
    </div>
  );
}
