import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShopByHandle } from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { isShopLive } from "@sailo/core/visibility";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { verifyDataRequest } from "@sailo/account/data-requests";
import { DATA_REQUEST_WINDOW_DAYS } from "@sailo/core/privacy";

/*
 * Not yet converted — see the note in `next.config.ts`.
 *
 * `export const dynamic = "force-dynamic"` was here too and broke the build:
 * this Next refuses the route segment config alongside `cacheComponents`, and
 * it is the only place in `apps/web` that still carried one. `instant = false`
 * is the conversion this codebase uses instead and already says the same
 * thing, so the line was redundant as well as fatal.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Confirm your request",
  robots: { index: false, follow: false },
};

/**
 * The click that turns a form submission into a request from a person.
 *
 * Spec 52's central rule lives here: **verification before assembly, always.**
 * Nothing has been read and nothing has been written about this buyer before
 * this page runs, and the only thing it does is set `verifiedAt` and start the
 * thirty-day clock.
 *
 * ## Why this is a page and not a POST
 *
 * The subscribe flow deliberately confirms on a POST, because a GET that
 * subscribed somebody would add people whose corporate mail scanner opened the
 * link. The trade is the other way round here: this route grants nothing, sends
 * nothing and deletes nothing — it records that the address confirmed, and a
 * scanner "confirming" only surfaces a request the seller then has to act on
 * with a human in the loop. Making the buyer click twice for that would lose
 * the ones who do not.
 *
 * ## Rate-limited, and constant in its answers
 *
 * A forged token, an expired one and one naming a row that no longer exists all
 * produce the same page. The distinctions are information about our rows,
 * offered to whoever is holding a token that does not work.
 */
export default async function VerifyDataRequestPage({
  params,
}: PageProps<"/[handle]/data-request/[token]">) {
  const { handle, token } = await params;

  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) notFound();

  const { t, locale, dir } = await getShopT(shop.locale);

  /*
   * DECISION B — fails closed. The token is the authorisation, so an unmetered
   * endpoint is an offline guessing attack made online. A refusal here is not
   * an answer about the token: the page says "try again in a moment", which is
   * what `COUPON_MESSAGES.unavailable` says for the same reason.
   */
  const gate = await rateLimit(`data-request-verify:${await callerIp()}`, 20, 300, {
    onOutage: "closed",
  });

  const result = gate.allowed ? await verifyDataRequest(token) : null;

  const heading = !gate.allowed
    ? t.dataRequest.unavailable
    : result?.ok
      ? t.dataRequest.confirmed
      : result?.reason === "unavailable"
        ? t.dataRequest.unavailable
        : t.dataRequest.badLink;

  const body =
    gate.allowed && result?.ok
      ? interpolate(t.dataRequest.confirmedBody, {
          shop: shop.name,
          days: String(DATA_REQUEST_WINDOW_DAYS),
        })
      : interpolate(t.dataRequest.badLinkBody, { shop: shop.name });

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[480px] px-4 py-16 sm:py-24">
        <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-2 text-sm leading-relaxed opacity-70">{body}</p>

        <Link
          href={`/${shop.handle}`}
          className="focus-ring-accent mt-8 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 opacity-70 transition hover:opacity-100"
        >
          {interpolate(t.pages.visitShop, { shop: shop.name })}
        </Link>
      </div>
    </div>
  );
}
