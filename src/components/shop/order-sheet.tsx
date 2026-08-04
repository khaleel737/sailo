"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  Gift,
  Loader2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import {
  createOrderIntent,
  previewOrder,
  submitPaymentReference,
  type OrderIntentResult,
} from "@/lib/actions/orders";
import { PAYMENT_METHOD_DEFS, type PaymentMethodType } from "@/lib/payments";
import { DELIVERY_METHOD_DEFS, type DeliveryMethodType } from "@/lib/delivery";
import type { Totals } from "@/lib/pricing";
import { readReferralCode } from "@/lib/referral";
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

type Props = {
  shopId: string;
  shopName: string;
  productId: string;
  productTitle: string;
  priceCents: number;
  currency: string;
  inStock: boolean;
  methods: CheckoutMethod[];
  deliveryOptions: CheckoutDelivery[];
  /** Physical goods need delivering; digital and services don't. */
  isPhysical: boolean;
  /** Shop-level switch for asking after a delivery address. */
  collectAddress: boolean;
  contactEmail: string | null;
  className?: string;
  label?: string;
};

export function OrderButton({ className, label = "Order now", ...props }: Props) {
  const [open, setOpen] = useState(false);
  const disabled = !props.inStock || props.methods.length === 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          className ??
          "accent-bg h-11 w-full rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {!props.inStock
          ? "Sold out"
          : props.methods.length === 0
            ? "Unavailable"
            : label}
      </button>
      {open ? <OrderSheet {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function OrderSheet({
  shopId,
  shopName,
  productId,
  productTitle,
  priceCents,
  currency,
  methods,
  deliveryOptions,
  isPhysical,
  collectAddress,
  contactEmail,
  onClose,
}: Props & { onClose: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<PaymentMethodType>(methods[0].type);
  const [deliveryId, setDeliveryId] = useState<string | null>(
    deliveryOptions[0]?.id ?? null,
  );
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [totals, setTotals] = useState<Totals>({
    subtotalCents: priceCents,
    discountCents: 0,
    deliveryFeeCents: 0,
    totalCents: priceCents,
    commissionCents: 0,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<
    OrderIntentResult,
    { ok: true }
  > | null>(null);

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
    let cancelled = false;
    previewOrder({
      shopId,
      productId,
      quantity,
      deliveryMethodId: deliveryId ?? undefined,
      couponCode: appliedCoupon || undefined,
    }).then((res) => {
      if (cancelled || "error" in res) return;
      setTotals(res.totals);
      if (appliedCoupon && res.couponError) {
        setCouponError(res.couponError);
        setAppliedCoupon("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, productId, quantity, deliveryId, appliedCoupon]);

  async function onApplyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponError(null);

    const res = await previewOrder({
      shopId,
      productId,
      quantity,
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
    setTotals(res.totals);
  }

  const def = PAYMENT_METHOD_DEFS[method];
  const isManual = def.kind === "manual";
  const selectedDelivery = deliveryOptions.find((d) => d.id === deliveryId);
  const needsAddress =
    isPhysical &&
    collectAddress &&
    (!selectedDelivery || selectedDelivery.type === "shipping");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const res = await createOrderIntent({
      shopId,
      productId,
      quantity,
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
      aria-label={`Order ${productTitle}`}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div className="surface-card animate-rise relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted absolute right-4 top-4 transition hover:opacity-70"
        >
          <X className="size-5" />
        </button>

        {result ? (
          <Confirmation
            result={result}
            shopName={shopName}
            contactEmail={contactEmail}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="pr-8">
              <h2 className="font-semibold leading-tight">{productTitle}</h2>
              <p className="text-muted mt-0.5 text-sm">
                {formatMoney(priceCents, currency)} each
              </p>
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            ) : null}

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Quantity</span>
              <div className="surface-elevated flex items-center rounded-lg">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  className="flex size-9 items-center justify-center transition hover:opacity-60"
                >
                  <Minus className="size-4" />
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.min(999, q + 1))}
                  aria-label="Increase quantity"
                  className="flex size-9 items-center justify-center transition hover:opacity-60"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>

            {isPhysical && deliveryOptions.length > 0 ? (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium">
                  How would you like to receive it?
                </legend>
                <div className="space-y-1.5">
                  {deliveryOptions.map((option) => {
                    const d = DELIVERY_METHOD_DEFS[option.type];
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
                                ? "Free"
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
                              Free over{" "}
                              {formatMoney(option.freeOverCents, currency)}
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
                  How would you like to order?
                </legend>
                <div className="space-y-1.5">
                  {methods.map((m) => {
                    const d = PAYMENT_METHOD_DEFS[m.type];
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
                placeholder="Your name"
                autoComplete="name"
                className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  name="customerEmail"
                  type="email"
                  placeholder={isManual ? "Email" : "Email (optional)"}
                  autoComplete="email"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
                <input
                  name="customerPhone"
                  type="tel"
                  placeholder={isManual ? "Phone" : "Phone (optional)"}
                  autoComplete="tel"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
              </div>
              {isManual ? (
                <p className="text-muted text-xs">
                  Give at least one so {shopName} can reach you about this order.
                </p>
              ) : null}
            </div>

            {needsAddress ? (
              <fieldset className="space-y-2.5">
                <legend className="mb-1.5 text-sm font-medium">
                  Delivery address
                </legend>
                <input
                  name="addressLine1"
                  placeholder="Street address"
                  autoComplete="address-line1"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
                <input
                  name="addressLine2"
                  placeholder="Apartment, suite (optional)"
                  autoComplete="address-line2"
                  className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="city"
                    placeholder="City"
                    autoComplete="address-level2"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="region"
                    placeholder="State / region"
                    autoComplete="address-level1"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="postalCode"
                    placeholder="Postal code"
                    autoComplete="postal-code"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                  <input
                    name="country"
                    placeholder="Country"
                    autoComplete="country-name"
                    className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
                  />
                </div>
              </fieldset>
            ) : null}

            <textarea
              name="note"
              rows={2}
              placeholder="Size, colour, delivery notes…"
              className="surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50"
            />

            <div>
              {appliedCoupon ? (
                <div className="surface-elevated flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
                  <span className="text-sm">
                    <span className="font-semibold">{appliedCoupon}</span>{" "}
                    <span className="text-muted">applied</span>
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
                    Remove
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
                    placeholder="Discount code"
                    aria-label="Discount code"
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
                      "Apply"
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
                <dt className="text-muted">Subtotal</dt>
                <dd className="tabular-nums">
                  {formatMoney(totals.subtotalCents, currency)}
                </dd>
              </div>
              {totals.discountCents > 0 ? (
                <div className="flex justify-between text-emerald-600">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">
                    −{formatMoney(totals.discountCents, currency)}
                  </dd>
                </div>
              ) : null}
              {isPhysical && selectedDelivery ? (
                <div className="flex justify-between">
                  <dt className="text-muted">
                    {selectedDelivery.name}
                  </dt>
                  <dd className="tabular-nums">
                    {totals.deliveryFeeCents === 0
                      ? "Free"
                      : formatMoney(totals.deliveryFeeCents, currency)}
                  </dd>
                </div>
              ) : null}
              <div className="surface-border flex justify-between border-t pt-1.5 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">
                  {formatMoney(totals.totalCents, currency)}
                </dd>
              </div>
            </dl>

            <button
              type="submit"
              disabled={pending}
              className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {def.action}
            </button>

            <p className="text-muted text-center text-xs">
              {def.kind === "contact"
                ? "Your order details are sent along so you don't have to type them."
                : "The seller gets your order and confirms payment."}
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
  onClose,
}: {
  result: Extract<OrderIntentResult, { ok: true }>;
  shopName: string;
  contactEmail: string | null;
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
      setRefError(res.error ?? "Couldn't save that.");
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
      <p className="text-center font-semibold">Order sent to {shopName}</p>
      <p className="text-muted mt-1 text-center text-sm">
        {hasBank
          ? "Transfer the total using the details below, then add your reference."
          : `Paid by ${result.methodName.toLowerCase()}.`}
      </p>

      {hasBank ? (
        <div className="surface-elevated mt-4 rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide opacity-60">
              Bank details
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
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <dl className="space-y-1.5">
            {result.bankDetails!.map((d) => (
              <div key={d.label} className="flex justify-between gap-3 text-sm">
                <dt className="text-muted shrink-0">{d.label}</dt>
                <dd className="text-right font-medium break-all">{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>
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
            placeholder="Transfer reference"
            className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
          />
          <button
            type="button"
            onClick={onSubmitReference}
            disabled={pending || !reference.trim()}
            className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            I&rsquo;ve sent the payment
          </button>
        </div>
      ) : null}

      {submitted ? (
        <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-center text-sm text-emerald-700">
          Thanks — {shopName} will confirm your payment shortly.
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
            Invoice {result.invoiceNumber}
          </span>
          <span className="text-muted text-xs">View · PDF</span>
        </a>
      ) : null}

      {result.referral ? (
        <ReferAndEarn referral={result.referral} shopName={shopName} />
      ) : null}

      {contactEmail ? (
        <p className="text-muted mt-3 text-center text-xs">
          Questions? {contactEmail}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onClose}
        className="surface-elevated mt-4 h-10 w-full rounded-xl text-sm font-medium"
      >
        Done
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
}: {
  referral: { code: string; url: string; percent: string };
  shopName: string;
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
        Earn {referral.percent}% on referrals
      </p>
      <p className="text-muted mt-1 text-xs leading-relaxed">
        Share your link. When someone buys from {shopName} through it, you earn{" "}
        {referral.percent}% of their order.
      </p>
      <div className="surface-elevated mt-2.5 flex items-center gap-2 rounded-lg p-2">
        <code className="min-w-0 flex-1 truncate text-xs">{referral.url}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium transition hover:opacity-70"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
