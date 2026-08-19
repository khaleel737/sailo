import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { orders, shops } from "@sailo/db/schema";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { readArrivalToken } from "@sailo/commerce/disputes";
import { confirmArrival } from "@/lib/actions/arrival";
import { ArrivalForm } from "./_components/arrival-form";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { PoweredBy } from "@/components/shared/powered-by";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * "Did your order arrive?"
 *
 * Opened from a link in the shipping email, by somebody with no session and no
 * cookie who may not remember the order — so everything the page needs is in the
 * token, exactly like the unsubscribe page next door.
 *
 * It shows a **button** and never acts on load. Every URL in an email is fetched
 * by something that is not the recipient, and a GET that recorded delivery would
 * file evidence with a card network on behalf of a buyer who never opened the
 * message. That is not a nicety here; it is the difference between evidence and
 * a false claim.
 */
export const metadata: Metadata = {
  title: "Did your order arrive?",
  robots: { index: false, follow: false },
};

export default async function ArrivedPage({
  params,
}: PageProps<"/arrived/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding threw on a bare `%`.
  const orderId = readArrivalToken(token);

  const order = orderId
    ? await getDb().query.orders.findFirst({
        where: eq(orders.id, orderId),
        columns: {
          id: true,
          shopId: true,
          shippedAt: true,
          deliveredAt: true,
          productTitle: true,
        },
      })
    : null;

  const shop = order
    ? await getDb().query.shops.findFirst({ where: eq(shops.id, order.shopId) })
    : null;

  const { t, locale, dir } = await getShopT(shop?.locale ?? null);
  const shopName = shop?.name ?? "";

  return (
    <div
      data-surface={shop?.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      // A dead link has no shop to take a colour from, and the page still has
      // to render — the ink is the app's own default in that case.
      style={shopThemeVars(shop?.accentColor ?? "#111111")}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[420px] px-4 py-20">
        {!order || !shop ? (
          <>
            <h1 className="text-xl font-bold">{t.arrival.title}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {interpolate(t.arrival.notFound, { shop: shopName })}
            </p>
          </>
        ) : order.deliveredAt ? (
          /*
           * Already recorded. Said plainly rather than shown as a button that
           * would do nothing — clicking twice is common and must not read as a
           * failure, and the claim underneath is conditional anyway.
           */
          <>
            <h1 className="text-xl font-bold">{t.arrival.confirmed}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.arrival.already}
            </p>
            <p className="text-muted mt-6 text-sm leading-relaxed">
              {interpolate(t.arrival.problem, { shop: shopName })}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t.arrival.title}</h1>
            {/*
              The sentence names a date, so it is only shown when there is one.
              This link is only ever put in a shipping email, so `shippedAt` is
              set on every legitimate arrival — but a sentence reading "sent this
              on ." is worse than no sentence, and the button below says what the
              page is for on its own.
            */}
            {order.shippedAt ? (
              <p className="text-muted mt-2 text-sm leading-relaxed">
                {interpolate(t.arrival.body, {
                  shop: shopName,
                  // Formatted in the reader's locale, the same way the download
                  // page states an expiry.
                  date: order.shippedAt.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                })}
              </p>
            ) : null}

            <ArrivalForm
              action={confirmArrival}
              token={token}
              label={t.arrival.confirm}
              doneTitle={t.arrival.confirmed}
              doneBody={interpolate(t.arrival.problem, { shop: shopName })}
              alreadyBody={t.arrival.already}
              unavailable={t.arrival.unavailable}
              invalid={interpolate(t.arrival.notFound, { shop: shopName })}
            />

            {/*
              The page must never imply that confirming closes a complaint. A
              buyer whose parcel arrived damaged still has a problem, and this
              line is what keeps "it arrived" from reading as "and it was fine".
            */}
            <p className="text-muted mt-6 text-sm leading-relaxed">
              {interpolate(t.arrival.problem, { shop: shopName })}
            </p>
          </>
        )}

        {shop ? (
          <div className="mt-10">
            <PoweredBy shop={shop} t={t} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
