import type { Metadata } from "next";
import { orderSummaryTitle } from "@/lib/order-lines";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toString as qrSvg } from "qrcode";
import { Clock, Download, FileDown, Lock, Store, Ticket } from "lucide-react";
import { getDownloadByToken, downloadState } from "@/lib/downloads";
import { ticketsForOrder } from "@/lib/tickets";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { PoweredBy } from "@/components/shared/powered-by";
import { formatBytes, shopThemeVars } from "@/lib/utils";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;


/** A private link — never something a search engine should hold on to. */
export const metadata: Metadata = {
  title: "Your download",
  robots: { index: false, follow: false },
};

export default async function DownloadPage({
  params,
}: PageProps<"/download/[token]">) {
  const { token } = await params;
  const record = await getDownloadByToken(token);
  if (!record) notFound();

  const { order, shop, files } = record;
  const state = downloadState(order);
  const { locale, t, dir } = await getShopT(shop.locale);

  /*
   * Admissions, when the order carries any. Rendered as QR codes holding the
   * seller's check-in URL, so the door is any phone camera: scanning opens
   * /admin/checkin with the code filled in, behind the seller's own login.
   * Gated on `released` alone — expiry and the download cap are file terms,
   * and a ticket does not stop admitting because a PDF link went stale.
   */
  const orderTickets = await ticketsForOrder(order.id);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const ticketQrs = state.released
    ? await Promise.all(
        orderTickets.map(async (ticket) => ({
          ticket,
          svg: await qrSvg(`${base}/admin/checkin?code=${ticket.code}`, {
            type: "svg",
            margin: 0,
            errorCorrectionLevel: "M",
          }),
        })),
      )
    : [];

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[560px] px-4 pb-20 pt-10">
        <Link
          href={`/${shop.handle}`}
          className="text-muted mb-6 inline-flex items-center gap-1.5 text-sm transition hover:opacity-70"
        >
          <Store className="size-4" />
          {shop.name}
        </Link>

        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          {orderTickets.length > 0 ? t.tickets.title : t.download.title}
        </h1>
        <p className="text-muted mt-1 text-sm">
          {orderSummaryTitle(order)}
        </p>

        {files.length > 0 && state.open ? (
          <>
            <ul className="surface-card mt-6 divide-y divide-black/5 rounded-2xl">
              {files.map((file) => (
                <li key={file.id}>
                  <a
                    href={`/api/download/${token}/${file.id}`}
                    className="flex items-center gap-3 p-4 transition hover:opacity-70"
                  >
                    <FileDown className="size-5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {file.name}
                      </span>
                      {file.sizeBytes ? (
                        <span className="text-muted block text-xs">
                          {formatBytes(file.sizeBytes)}
                        </span>
                      ) : null}
                    </span>
                    <span className="accent-bg flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold">
                      <Download className="size-3.5" />
                      {t.download.file}
                    </span>
                  </a>
                </li>
              ))}
            </ul>

            <div className="text-muted mt-4 space-y-1 text-xs">
              {state.remaining !== null ? (
                <p>
                  {interpolate(t.download.remaining, { count: state.remaining })}
                </p>
              ) : null}
              {order.downloadExpiresAt ? (
                <p className="flex items-center gap-1.5">
                  <Clock className="size-3.5" />
                  {interpolate(t.download.expires, {
                    date: order.downloadExpiresAt.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    }),
                  })}
                </p>
              ) : null}
            </div>
          </>
        ) : files.length > 0 || !state.released ? (
          <div className="surface-card mt-6 flex items-start gap-3 rounded-2xl p-4">
            <Lock className="mt-0.5 size-5 shrink-0 opacity-60" />
            <p className="text-sm leading-relaxed">
              {!state.released
                ? interpolate(
                    orderTickets.length > 0
                      ? t.tickets.notReady
                      : t.download.notReady,
                    { shop: shop.name },
                  )
                : state.expired
                  ? interpolate(t.download.expired, { shop: shop.name })
                  : interpolate(t.download.usedUp, { shop: shop.name })}
              {shop.contactEmail ? (
                <span className="text-muted mt-1 block text-xs">
                  {interpolate(t.checkout.questions, {
                    email: shop.contactEmail,
                  })}
                </span>
              ) : null}
            </p>
          </div>
        ) : null}

        {ticketQrs.length > 0 ? (
          <ul className="mt-6 space-y-4">
            {ticketQrs.map(({ ticket, svg }) => (
              <li
                key={ticket.id}
                className={`surface-card flex items-center gap-4 rounded-2xl p-4 ${
                  ticket.status === "valid" ? "" : "opacity-50"
                }`}
              >
                <div
                  className="size-24 shrink-0 rounded-lg bg-white p-1.5 [&_svg]:size-full"
                  // Generated by us from a code we minted — never buyer input.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-60">
                    <Ticket className="size-3.5" />
                    {t.tickets.admitOne}
                  </p>
                  <p className="mt-1 font-mono text-lg font-semibold tracking-wide">
                    {ticket.code}
                  </p>
                  <p className="text-muted mt-0.5 text-xs">
                    {ticket.status === "valid"
                      ? t.tickets.showAtDoor
                      : t.tickets.used}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <Link
          href={`/${shop.handle}`}
          className="surface-elevated mt-6 flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium transition hover:opacity-70"
        >
          {interpolate(t.download.visitShop, { shop: shop.name })}
        </Link>

        <footer className="mt-8 flex justify-center">
          <PoweredBy shop={shop} t={t} />
        </footer>
      </div>
    </div>
  );
}
