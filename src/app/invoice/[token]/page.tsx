import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Store } from "lucide-react";
import { getInvoiceByToken } from "@/lib/queries";
import { PAYMENT_METHOD_DEFS, isPaymentMethodType } from "@/lib/payments";
import { PrintButton } from "@/components/shop/print-button";
import { getShopT } from "@/i18n/server";
import { formatPercent } from "@/lib/pricing";
import { formatAddress, formatMoney } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Invoice",
  robots: { index: false, follow: false },
};

export default async function InvoicePage({
  params,
}: PageProps<"/invoice/[token]">) {
  const { token } = await params;
  const data = await getInvoiceByToken(token);
  if (!data) notFound();

  const { invoice, order, shop, items } = data;
  const { locale, t, dir } = await getShopT(shop.locale);
  const address = formatAddress(order);
  const methodName = isPaymentMethodType(order.paymentMethod)
    ? PAYMENT_METHOD_DEFS[order.paymentMethod].name
    : order.paymentMethod;

  const paidTone =
    order.paymentStatus === "paid"
      ? "bg-emerald-100 text-emerald-800"
      : order.paymentStatus === "pending"
        ? "bg-amber-100 text-amber-800"
        : "bg-ink-100 text-ink-700";

  return (
    <div
      dir={dir}
      lang={locale}
      className="min-h-screen bg-ink-50 px-4 py-8 print:bg-white print:py-0"
    >
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link
            href={`/${shop.handle}`}
            className="text-sm text-ink-500 transition hover:text-ink-900"
          >
            ← {shop.name}
          </Link>
          <div className="flex gap-2">
            <a
              href={`/invoice/${invoice.token}/pdf`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink-900 px-3 text-sm font-medium text-white transition hover:bg-ink-800"
            >
              <Download className="size-4" />
              {t.invoice.downloadPdf}
            </a>
            <PrintButton label={t.invoice.print} />
          </div>
        </div>

        <article className="rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-10 print:border-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 pb-6">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{shop.name}</h1>
              {shop.location ? (
                <p className="mt-0.5 text-sm text-ink-500">{shop.location}</p>
              ) : null}
              {shop.contactEmail ? (
                <p className="text-sm text-ink-500">{shop.contactEmail}</p>
              ) : null}
              {shop.taxId ? (
                <p className="mt-1 text-xs text-ink-400">
                  {t.invoice.taxId}: {shop.taxId}
                </p>
              ) : null}
            </div>

            <div className="text-end">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                {t.invoice.invoice}
              </p>
              <p className="text-lg font-semibold">{invoice.number}</p>
              <p className="mt-0.5 text-sm text-ink-500">
                {invoice.issuedAt.toLocaleDateString(locale, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <span
                className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${paidTone}`}
              >
                {order.paymentStatus === "paid"
                  ? t.invoice.paid
                  : order.paymentStatus === "pending"
                    ? t.invoice.paymentSent
                    : t.invoice.unpaid}
              </span>
            </div>
          </header>

          <section className="grid gap-6 border-b border-ink-100 py-6 sm:grid-cols-2">
            <div>
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
                {t.invoice.billedTo}
              </h2>
              <p className="text-sm font-medium">
                {order.customerName ?? "Customer"}
              </p>
              {order.customerEmail ? (
                <p className="text-sm text-ink-600">{order.customerEmail}</p>
              ) : null}
              {order.customerPhone ? (
                <p className="text-sm text-ink-600">{order.customerPhone}</p>
              ) : null}
              {address ? (
                <p className="mt-1 text-sm leading-relaxed text-ink-600">
                  {address}
                </p>
              ) : null}
            </div>

            <div className="sm:text-end">
              <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
                {t.invoice.details}
              </h2>
              <p className="text-sm text-ink-600">
                {t.invoice.payment}: {methodName}
              </p>
              {order.deliveryLabel ? (
                <p className="text-sm text-ink-600">
                  {t.invoice.delivery}: {order.deliveryLabel}
                </p>
              ) : null}
              {order.pickupLocation ? (
                <p className="text-sm text-ink-600">
                  {t.invoice.pickup}: {order.pickupLocation}
                </p>
              ) : null}
              {order.paymentReference ? (
                <p className="text-sm text-ink-600">
                  {t.invoice.reference}: {order.paymentReference}
                </p>
              ) : null}
            </div>
          </section>

          <table className="w-full py-6 text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-start text-xs uppercase tracking-wide text-ink-400">
                <th className="py-2 font-medium">{t.invoice.item}</th>
                <th className="py-2 text-end font-medium">{t.invoice.qty}</th>
                <th className="py-2 text-end font-medium">{t.invoice.price}</th>
                <th className="py-2 text-end font-medium">{t.invoice.amount}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="py-3 font-medium">
                    {item.title}
                    {item.variantLabel || item.sku ? (
                      <span className="block text-xs font-normal text-ink-500">
                        {[item.variantLabel, item.sku].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                    {item.scheduledFor ? (
                      <span className="block text-xs font-normal text-ink-500">
                        {item.scheduledFor.toLocaleString(locale, {
                          day: "numeric",
                          month: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 text-end tabular-nums">{item.quantity}</td>
                  <td className="py-3 text-end tabular-nums">
                    {formatMoney(item.unitPriceCents, order.currency)}
                  </td>
                  <td className="py-3 text-end tabular-nums">
                    {formatMoney(item.subtotalCents, order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ms-auto max-w-xs space-y-1.5 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">{t.checkout.subtotal}</dt>
              <dd className="tabular-nums">
                {formatMoney(order.subtotalCents, order.currency)}
              </dd>
            </div>
            {order.discountCents > 0 ? (
              <div className="flex justify-between text-emerald-600">
                <dt>
                  {t.checkout.discount}{" "}
                  {order.couponCode ? `(${order.couponCode})` : ""}
                </dt>
                <dd className="tabular-nums">
                  −{formatMoney(order.discountCents, order.currency)}
                </dd>
              </div>
            ) : null}
            {order.deliveryFeeCents > 0 ? (
              <div className="flex justify-between">
                <dt className="text-ink-500">
                  {order.deliveryLabel ?? t.invoice.delivery}
                </dt>
                <dd className="tabular-nums">
                  {formatMoney(order.deliveryFeeCents, order.currency)}
                </dd>
              </div>
            ) : null}
            {order.taxCents > 0 && !order.taxInclusive ? (
              <div className="flex justify-between">
                <dt className="text-ink-500">
                  {order.taxName ?? t.invoice.tax}
                  {order.taxRateBp > 0
                    ? ` (${formatPercent(order.taxRateBp)}%)`
                    : ""}
                </dt>
                <dd className="tabular-nums">
                  {formatMoney(order.taxCents, order.currency)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold">
              <dt>{t.checkout.total}</dt>
              <dd className="tabular-nums">
                {formatMoney(order.totalCents, order.currency)}
              </dd>
            </div>
            {order.taxCents > 0 && order.taxInclusive ? (
              <div className="flex justify-between text-xs text-ink-500">
                <dt>
                  {t.invoice.includes} {order.taxName ?? t.invoice.tax}
                  {order.taxRateBp > 0
                    ? ` (${formatPercent(order.taxRateBp)}%)`
                    : ""}
                </dt>
                <dd className="tabular-nums">
                  {formatMoney(order.taxCents, order.currency)}
                </dd>
              </div>
            ) : null}
          </dl>

          {order.note ? (
            <p className="mt-6 border-t border-ink-100 pt-4 text-sm text-ink-600">
              <span className="font-medium">{t.invoice.note}:</span> {order.note}
            </p>
          ) : null}

          {shop.invoiceNotes ? (
            <p className="mt-4 whitespace-pre-wrap text-xs leading-relaxed text-ink-500">
              {shop.invoiceNotes}
            </p>
          ) : null}
        </article>

        <p className="mt-4 text-center text-xs text-ink-400 print:hidden">
          <Link href="/" className="inline-flex items-center gap-1.5">
            <Store className="size-3" />
            {t.shop.poweredBy} Sailo
          </Link>
        </p>
      </div>
    </div>
  );
}
