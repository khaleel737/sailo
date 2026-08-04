"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Minus, Plus, X } from "lucide-react";
import { createOrderIntent } from "@/lib/actions/orders";
import { formatMoney } from "@/lib/utils";

type Props = {
  shopId: string;
  shopName: string;
  productId: string;
  productTitle: string;
  priceCents: number;
  currency: string;
  hasWhatsApp: boolean;
  contactEmail: string | null;
  inStock: boolean;
  className?: string;
  label?: string;
};

export function OrderButton({ className, label = "Order now", ...props }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={!props.inStock}
        onClick={() => setOpen(true)}
        className={
          className ??
          "accent-bg h-11 w-full rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {props.inStock ? label : "Sold out"}
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
  hasWhatsApp,
  contactEmail,
  onClose,
}: Props & { onClose: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const result = await createOrderIntent({
      shopId,
      productId,
      quantity,
      customerName: String(data.get("customerName") ?? ""),
      customerContact: String(data.get("customerContact") ?? ""),
      note: String(data.get("note") ?? ""),
    });

    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }

    if (result.whatsappUrl) {
      window.location.href = result.whatsappUrl;
      return;
    }

    // No WhatsApp configured — the lead is saved, tell the buyer what happens next.
    setSent(true);
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

      <div className="surface-card animate-rise relative w-full max-w-md rounded-t-2xl p-5 sm:rounded-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted absolute right-4 top-4 transition hover:opacity-70"
        >
          <X className="size-5" />
        </button>

        {sent ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="size-6" />
            </div>
            <p className="font-semibold">Order sent to {shopName}</p>
            <p className="text-muted mt-1 text-sm">
              They&rsquo;ll get back to you
              {contactEmail ? ` — or reach them at ${contactEmail}` : " shortly"}.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="surface-elevated mt-5 h-10 w-full rounded-xl text-sm font-medium"
            >
              Done
            </button>
          </div>
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

            <input
              name="customerName"
              placeholder="Your name"
              autoComplete="name"
              className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
            />
            <input
              name="customerContact"
              placeholder="Phone or email (optional)"
              className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
            />
            <textarea
              name="note"
              rows={2}
              placeholder="Size, colour, delivery notes…"
              className="surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50"
            />

            <div className="flex items-center justify-between border-t pt-3 text-sm surface-border">
              <span className="text-muted">Total</span>
              <span className="text-base font-semibold tabular-nums">
                {formatMoney(priceCents * quantity, currency)}
              </span>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {hasWhatsApp ? "Continue on WhatsApp" : "Send order"}
            </button>

            <p className="text-muted text-center text-xs">
              {hasWhatsApp
                ? "Opens WhatsApp with your order details filled in."
                : "The seller receives your order in their dashboard."}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
