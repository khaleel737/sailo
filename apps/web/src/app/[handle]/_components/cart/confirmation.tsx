"use client";

import { useState } from "react";
import { Check, Copy, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { trackClick } from "@sailo/analytics/clicks";
import { submitPaymentReference } from "@/lib/actions/payment-reference";
import type { OrderIntentResult } from "@sailo/commerce/orders";
import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
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
  shopId,
  shopName,
  contactEmail,
  methodName,
  t,
  onClose,
}: {
  result: Extract<OrderIntentResult, { ok: true }>;
  shopId: string;
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
  const [copiedOrder, setCopiedOrder] = useState(false);

  const bank = result.bankDetails ?? [];
  const hasBank = bank.length > 0;

  /*
   * Venmo and PayPal hand the buyer a wallet to open, Instagram a DM. Each is
   * a link and not a redirect on purpose — the order is unpaid until they come
   * back, and on Instagram the message they have to send is on this page, so
   * the page they return to has to still be here. `noopener` for the same
   * reason every outbound link needs it, and `_blank` so the back button is
   * not the only way home.
   */
  const handoff = result.handoff?.kind === "instructions" ? result.handoff : null;
  const pay = handoff?.payUrl
    ? { url: handoff.payUrl, label: handoff.payLabel }
    : null;
  /*
   * The rail cannot prefill what it opens, so the buyer carries the order
   * across by hand. Shown rather than merely copied: a clipboard write can be
   * refused — Safari grants it only inside the gesture that asked, and an
   * in-app browser may not grant it at all — and a buyer who arrives in the
   * DM with an empty clipboard and no way back has lost the whole order.
   */
  const toPaste = handoff?.copyToSend ? (handoff.message ?? null) : null;

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

  async function copyOrder() {
    if (!toPaste) return;
    try {
      await navigator.clipboard.writeText(toPaste);
      setCopiedOrder(true);
      setTimeout(() => setCopiedOrder(false), 2000);
    } catch {
      // The message is on screen to select by hand, so a refused clipboard
      // costs the buyer a long-press rather than the order.
    }
  }

  /*
   * Leaving through a link the seller put there — the same outbound click the
   * chat rails have always counted. Instagram used to be counted at the
   * redirect; now that it stays on this page, this is where that click
   * happens, and the wallets are counted with it for the same reason.
   *
   * The copy rides along because this is the one moment every browser grants
   * the clipboard: inside the gesture that navigates. So the buyer arrives in
   * the DM with the order already on the pasteboard whether or not they
   * pressed Copy first — and the button above stays, because this can still be
   * refused and a new tab is not always where they end up.
   */
  function openPay() {
    if (pay) trackClick(shopId, pay.url, "contact");
    if (toPaste) void copyOrder();
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
          : toPaste
            ? interpolate(t.checkout.pasteNote, { method: methodName })
            : interpolate(t.checkout.paidBy, { method: methodName })}
      </p>

      {toPaste ? (
        <div className="surface-elevated mt-4 rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-medium uppercase tracking-wide opacity-60">
              {t.checkout.yourOrder}
            </span>
            <button
              type="button"
              onClick={copyOrder}
              className="inline-flex items-center gap-1 text-xs font-medium transition hover:opacity-70"
            >
              {copiedOrder ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copiedOrder ? t.checkout.copied : t.checkout.copy}
            </button>
          </div>
          {/*
            Capped and scrollable: a basket of eight lines with an address on
            it is longer than the sheet, and pushing the button that opens the
            chat off the bottom is the same failure as not showing the message
            at all.
          */}
          <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-sm">
            {toPaste}
          </p>
        </div>
      ) : null}

      {pay ? (
        <a
          href={pay.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openPay}
          onAuxClick={(event) => {
            if (event.button === 1) openPay();
          }}
          className="accent-bg mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90"
        >
          {interpolate(toPaste ? t.checkout.openApp : t.checkout.payWith, {
            method: pay.label ?? methodName,
          })}
          <ExternalLink className="size-4" />
        </a>
      ) : null}

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
