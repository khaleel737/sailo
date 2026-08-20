import type { Metadata } from "next";
import { orderSummaryTitle } from "@/lib/order-lines";
import Link from "next/link";
import { notFound } from "next/navigation";
import { toString as qrSvg } from "qrcode";
import {
  ArrowUpRight,
  CalendarPlus,
  Clock,
  Download,
  FileDown,
  KeyRound,
  Lock,
  MapPin,
  MonitorSmartphone,
  Store,
  Ticket,
  Video,
} from "lucide-react";
import { LocalTime } from "@sailo/design-system/web";
import { getDownloadByToken, downloadState } from "@/lib/downloads";
import { ticketsForOrder } from "@sailo/commerce/ticketing";
import { digitalAccessForOrder, licensesForOrder } from "@sailo/commerce/orders/server";
import { eventAccessForOrder } from "@sailo/commerce/ticketing";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { PoweredBy } from "@/components/shared/powered-by";
import { formatBytes } from "@sailo/core/format";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { accessForOrder } from "@/lib/membership-access";
import { ensureMemberPass } from "@sailo/commerce/memberships/server";
import { MembershipCard } from "./_components/membership-card";
import { CollectionList } from "./_components/collection-list";
import { collectionForProduct, readableCollection } from "@sailo/commerce/content";

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
   * The digital goods that are not files — a link, a code — read from the
   * order's *lines* for the same reason the events are, and gated by the same
   * `downloadReleasedAt`. `digitalAccessForOrder` returns `value: null` until
   * the order has earned it, so there is no gate on this page to get wrong.
   */
  const access = await digitalAccessForOrder(order);

  /*
   * The licence keys this order minted — spec 48.
   *
   * Read by order, and only rendered once the order is released: the key is a
   * bearer credential that turns a stranger's software on, so it is held back
   * by exactly the timestamp that holds back a file. `licensesForOrder`
   * filters on `order_id`, so this page has no way to reach anybody else's.
   */
  const licenses = state.released ? await licensesForOrder(order.id) : [];

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

  /*
   * The product's gated content, if the seller has built any. Spec 40.
   *
   * `accessOpen` is the answer the *existing* gate already gave — `state.open`
   * for a one-off purchase, `membership.access.open` for a membership — handed
   * in rather than recomputed. That is the whole design: the collection writes
   * no new access predicate, and a parameter cannot become a second opinion.
   *
   * The anchor is when access began: the subscription's start for a member, so
   * a course drips from the day they joined rather than from the day of
   * whichever renewal order the token belongs to.
   */
  const collection = product ? await collectionForProduct(product.id) : null;
  const content = collection
    ? await readableCollection({
        collection,
        order,
        accessOpen: membership.isMembership ? membership.access.open : state.open,
        anchor: membership.isMembership
          ? (membership.subscription?.startedAt ?? order.downloadReleasedAt)
          : order.downloadReleasedAt,
      })
    : null;

  /*
   * The member's door pass, for a membership somebody physically turns up to.
   *
   * Gated on the product's own in-person switch — the same rule
   * `handedOverInPerson` applies to a membership when it decides whether cash
   * at the door is on offer. A paid newsletter and a Discord invite have no
   * door, and minting them a credential would be a live code to lose in
   * exchange for nothing.
   *
   * Minted only while access is open, so a lapsed member is not handed a fresh
   * code on the way out. The door does not rely on that: `checkInMemberByCode`
   * re-reads the subscription on every scan, exactly as the streaming route
   * re-reads it on every byte.
   */
  const memberPass =
    membership.subscription && membership.access.open && product?.serviceMode !== "online"
      ? await ensureMemberPass(membership.subscription.id, shop.id)
      : null;

  const memberPassQr = memberPass
    ? await qrSvg(`${base}/admin/checkin?code=${memberPass}`, {
        type: "svg",
        margin: 0,
      })
    : null;
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
            passCode={memberPass}
            passQr={memberPassQr}
            labels={{
              title: t.membership.title,
              activeUntil: t.membership.activeUntil,
              endingOn: t.membership.endingOn,
              pastDue: t.membership.pastDue,
              ended: t.membership.ended,
              manage: t.membership.manage,
              manualRenew: t.membership.manualRenew,
              manualPending: t.membership.manualPending,
              pass: t.membership.pass,
              // Reused rather than duplicated: a member and a ticket-holder are
              // told the same thing because they are doing the same thing.
              showAtDoor: t.tickets.showAtDoor,
            }}
          />
        ) : null}

        {/*
          The collection — spec 40. Above the flat file list, because when a
          seller has grouped their files into lessons that ordering *is* the
          product, and a duplicate unordered list under it would be the same
          files twice.
        */}
        {content ? (
          <CollectionList
            token={token}
            data={content}
            labels={{
              progress: t.collection.progress,
              continueLabel: t.collection.continueLabel,
              preview: t.collection.preview,
              locked: t.collection.locked,
              unlocksIn: t.collection.unlocksIn,
              markDone: t.collection.markDone,
              done: t.collection.done,
              open: t.collection.open,
            }}
          />
        ) : null}

        {files.length > 0 && state.open && !content ? (
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
                      {/*
                        The version and the date it was last touched — spec 48.
                        A buyer who paid for v1 and is handed v3 has a support
                        problem; a buyer who can see which one they are holding
                        has an answer. This is the whole of "file versions" on
                        this page: a label, not a second entitlement model.
                      */}
                      {file.version || file.sizeBytes ? (
                        <span className="text-muted block text-xs">
                          {[
                            file.version,
                            file.sizeBytes ? formatBytes(file.sizeBytes) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
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
        ) : (files.length > 0 && !content) || !state.released ? (
          /*
           * `&& !content` — spec 40, and it is load-bearing.
           *
           * The flat file list above is skipped when a collection is rendering
           * the same files in order, and without this the *lock* branch caught
           * the order instead: a perfectly healthy course showed "you've used
           * every download on this link" under a working lesson list. Nothing
           * in the type system or the tests could see it; reading the page did.
           *
           * `!state.released` still reaches here on purpose. A collection shows
           * previews to an unreleased order, and the buyer is owed the sentence
           * explaining why the rest is shut.
           */
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

        {access.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {access.map((item) => (
              <li key={item.productId} className="surface-card rounded-2xl p-4">
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-60">
                  {item.delivery === "link" ? (
                    <ArrowUpRight className="size-3.5" />
                  ) : (
                    <KeyRound className="size-3.5" />
                  )}
                  {item.delivery === "link"
                    ? t.download.linkLabel
                    : t.download.codeLabel}
                </p>
                <p className="mt-1 text-sm font-semibold">{item.title}</p>

                {item.value === null ? (
                  <p className="text-muted mt-2 flex items-center gap-1.5 text-xs">
                    <Lock className="size-3.5" />
                    {interpolate(t.download.notReady, { shop: shop.name })}
                  </p>
                ) : item.delivery === "link" ? (
                  <a
                    href={item.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="accent-bg mt-3 inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
                  >
                    {t.download.open}
                    <ArrowUpRight className="size-4" />
                  </a>
                ) : (
                  /*
                   * One block per code, because a buyer who bought three
                   * licences was given three — spec 48. `values` is the whole
                   * list and `value` is its first entry, so a single shared
                   * code renders exactly as it always did.
                   *
                   * Selectable and wrapped, not truncated. This *is* the good:
                   * a buyer who cannot copy the whole of it has not been given
                   * what they paid for, so it wraps rather than eliding and
                   * keeps the seller's own line breaks.
                   */
                  <div className="mt-3 space-y-2">
                    {(item.values.length > 0 ? item.values : [item.value]).map(
                      (code) => (
                        <p
                          key={code}
                          className="whitespace-pre-wrap break-words rounded-xl bg-black/5 px-3 py-2.5 font-mono text-sm leading-relaxed"
                        >
                          {code}
                        </p>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {/*
          The licences this order minted — spec 48.
          Below the codes and above the events, because a buyer who bought a
          licensed download reads down the page in the order they will use
          things: the file, the key that unlocks it, then anything they have to
          turn up to.
        */}
        {licenses.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {licenses.map((license) => (
              <li key={license.id} className="surface-card rounded-2xl p-4">
                {/*
                  `download.codeLabel` rather than a label of its own, and that
                  is a deliberate i18n decision rather than a shortcut. `download`
                  is a protected money section — no filler may write into it —
                  so a new key there would need a human translator in
                  thirty-four languages before the build would even compile, and
                  inventing an unprotected section for a string that names what
                  a digital sale delivers would be routing around the
                  protection rather than honouring it.

                  "Your access details" is already the right sentence for a
                  licence key, and it is already translated everywhere.
                */}
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide opacity-60">
                  <KeyRound className="size-3.5" />
                  {t.download.codeLabel}
                </p>
                <p className="mt-3 select-all break-words rounded-xl bg-black/5 px-3 py-2.5 font-mono text-sm leading-relaxed">
                  {license.key}
                </p>
                {/*
                  The metadata as *data* rather than as sentences — a seat count
                  and a date, both of which read in any language without a word
                  of copy. The alternative was four English strings shown to a
                  buyer in Warsaw.
                */}
                {license.activationLimit !== null || license.expiresAt ? (
                  <p className="text-muted mt-2 flex items-center gap-3 text-xs">
                    {license.activationLimit !== null ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MonitorSmartphone className="size-3.5" />
                        {license.activationLimit}
                      </span>
                    ) : null}
                    {license.expiresAt ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="size-3.5" />
                        {license.expiresAt.toLocaleDateString(locale, {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {events.length > 0 ? (
          <ul className="mt-6 space-y-3">
            {events.map((event) => (
              // Product *and* date — spec 50. One product can now be two rows,
              // a Tuesday and a Thursday of the same class, and keying on the
              // product alone would have React treat them as one.
              <li
                key={`${event.productId}:${event.sessionId ?? ""}`}
                className="surface-card rounded-2xl p-4"
              >
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
                   *
                   * The end, when the seller gave one, is a second `LocalTime`
                   * rather than a formatted range: both ends have to be
                   * converted in the browser, and a server-rendered dash
                   * between two client-rendered times is the only part of the
                   * sentence that can be laid out here.
                   */
                  <span className="text-muted mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                    <LocalTime at={event.startsAt.toISOString()} />
                    {event.endsAt ? (
                      <>
                        <span aria-hidden>&ndash;</span>
                        <LocalTime at={event.endsAt.toISOString()} />
                      </>
                    ) : null}
                  </span>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {event.joinUrl ? (
                    <a
                      href={event.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="accent-bg inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold"
                    >
                      <Video className="size-4" />
                      {t.tickets.join}
                    </a>
                  ) : null}

                  {/*
                    The calendar entry — spec 50, and the one thing a buyer
                    reliably does on this page.

                    `ics.ts` shipped with the wave carrying a stable UID, a
                    SEQUENCE and a VTIMEZONE, and nothing served a file, so none
                    of it reached anybody. Offered whether or not the order is
                    released: the date and the room were never the secret, and
                    the route hands over the join link only once
                    `eventAccessForOrder` says the order has earned it.

                    A plain link rather than a download attribute — the route
                    sets `content-disposition`, which is what iOS and Android
                    read to open the file in a calendar rather than show it.
                  */}
                  {event.startsAt ? (
                    <a
                      href={`/download/${token}/calendar?product=${event.productId}${
                        event.sessionId ? `&session=${event.sessionId}` : ""
                      }`}
                      className="surface-elevated inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold hover:opacity-70"
                    >
                      <CalendarPlus className="size-4" />
                      {t.tickets.addToCalendar}
                    </a>
                  ) : null}
                </div>

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
