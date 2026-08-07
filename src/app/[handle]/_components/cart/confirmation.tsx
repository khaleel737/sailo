"use client";

import { useState } from "react";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
import { submitPaymentReference } from "@/lib/actions/payment-reference";
import type { OrderIntentResult } from "@/lib/orders/types";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";
import { ReferAndEarn } from "./refer-and-earn";

/**
 * What the buyer sees once the order exists.
 *
 * Bank transfer needs the account details and a reference box; a card order
 * has already been paid by the time anyone reads this. Both end with the
 * invoice and, where the shop runs one, the referral offer.
 */
export function Confirmation({
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

  const bank = result.bankDetails ?? [];
  const hasBank = bank.length > 0;

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
    const text = bank
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
            {bank.map((d) => (
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
