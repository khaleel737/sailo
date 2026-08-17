import type { Metadata } from "next";
import { orderSummaryTitle } from "@/lib/order-lines";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toString as qrSvg } from "qrcode";
import { Clock, Download, FileDown, Lock, MapPin, Store, Ticket, Video } from "lucide-react";
import { LocalTime } from "@sailo/design-system/web";
import { getDownloadByToken, downloadState } from "@/lib/downloads";
import { ticketsForOrder } from "@sailo/commerce/ticketing";
import { eventAccessForOrder } from "@sailo/commerce/ticketing";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { PoweredBy } from "@/components/shared/powered-by";
import { formatBytes } from "@sailo/core/format";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { accessForOrder } from "@/lib/membership-access";
import { MembershipCard } from "./_components/membership-card";

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

  const { order, shop, product, files } = record;
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

  /*
   * The events this order registered for, and their join links.
   *
   * `eventAccessForOrder` decides on its own whether the links are earned —
   * it returns them only once `downloadReleasedAt` is set — so this page has
   * no gate of its own to get wrong. Read from the order's *lines*, so a
   * basket holding a mug and a webinar still shows the webinar.
   */
  const events = await eventAccessForOrder(order);

  /*
   * The membership behind this order, if it is one.
   *
   * Read here rather than gating the files above, because the files are
   * already gated where it counts — the streaming route asks the same question
   * on every request. This is the buyer's *view* of the arrangement, and the
   * only place they can act on it.
   */
  const membership = await accessForOrder(order);
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

        {membership.isMembership ? (
          <MembershipCard
            token={token}
            title={product?.title ?? orderSummaryTitle(order)}
            status={membership.subscription?.status ?? "canceled"}
            open={membership.access.open}
            endingSoon={membership.access.endingSoon}
            until={
              membership.access.until
                ? membership.access.until.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })
                : null
            }
            manual={membership.subscription?.billingMode === "manual"}
            awaitingPayment={membership.awaitingPayment}
            labels={{
              title: t.membership.title,
              activeUntil: t.membership.activeUntil,
              endingOn: t.membership.endingOn,
              pastDue: t.membership.pastDue,
              ended: t.membership.ended,
              manage: t.membership.manage,
              manualRenew: t.membership.manualRenew,
              manualPending: t.membership.manualPending,
            }}
          />
        ) : null}

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

        {events.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {events.map((event) => (
              <li key={event.productId} className="surface-card rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-60">
                  {event.online ? (
                    <Video className="size-3.5" />
                  ) : (
                    <MapPin className="size-3.5" />
                  )}
                  {event.online ? t.tickets.online : t.tickets.inPerson}
                </p>
                <p className="mt-1 text-sm font-semibold">{event.title}</p>

                {event.startsAt ? (
                  /*
                   * Rendered in the *buyer's* own zone, by their own browser.
                   * The server has no idea where they are, and "18:00" without
                   * a zone is the single most common webinar support ticket —
                   * so the one clock that cannot be wrong for them is theirs.
                   */
                  <LocalTime
                    at={event.startsAt.toISOString()}
                    className="text-muted mt-0.5 block text-xs"
                  />
                ) : null}

                {event.joinUrl ? (
                  <a
                    href={event.joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="accent-bg mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
                  >
                    <Video className="size-4" />
                    {t.tickets.join}
                  </a>
                ) : null}

                {event.online && !event.joinUrl ? (
                  <p className="text-muted mt-2 flex items-center gap-1.5 text-xs">
                    <Lock className="size-3.5" />
                    {event.locked
                      ? interpolate(t.tickets.joinLocked, { shop: shop.name })
                      : t.tickets.joinMissing}
                  </p>
                ) : null}

                {event.location ? (
                  <p className="text-muted mt-2 text-xs">{event.location}</p>
                ) : null}
              </li>
            ))}
          </ul>
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
