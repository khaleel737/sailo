import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { readUnsubscribeToken } from "@sailo/marketing/broadcasts/server";
import { isSuppressed } from "@sailo/marketing/broadcasts/server";
import { confirmUnsubscribe } from "@/lib/actions/unsubscribe";
import { UnsubscribeForm } from "@/components/shared/unsubscribe-form";
import { shopThemeVars } from "@/lib/utils";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * The page the unsubscribe link in the email body opens.
 *
 * No login, no cookie, and it has to work from a cold mail client months
 * after the message was sent — so everything it needs is in the token. It
 * shows a button rather than acting on load, because a GET must never
 * unsubscribe anybody: every URL in an email gets prefetched by scanners, and
 * a page that suppressed on render would remove people who never read it.
 */
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  params,
}: PageProps<"/u/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding threw on a bare `%`.
  const claim = readUnsubscribeToken(token);

  const shop = claim
    ? await getDb().query.shops.findFirst({ where: eq(shops.id, claim.shopId) })
    : null;

  const { t, locale, dir } = await getShopT(shop?.locale ?? null);

  // Already off the list: say so plainly rather than offering a button that
  // would do nothing. Clicking twice is common and must not look like failure.
  const already =
    claim && shop ? await isSuppressed(claim.shopId, claim.email) : false;

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
        {!claim || !shop ? (
          <>
            <h1 className="text-xl font-bold">{t.unsubscribe.invalidTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.unsubscribe.invalidBody}
            </p>
          </>
        ) : already ? (
          <>
            <h1 className="text-xl font-bold">{t.unsubscribe.doneTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {interpolate(t.unsubscribe.doneBody, { shop: shop.name })}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">
              {interpolate(t.unsubscribe.title, { shop: shop.name })}
            </h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {/*
                Named precisely: this stops marketing email, and it does not
                stop an order confirmation or a receipt. Somebody who
                unsubscribes and then buys something must still be told what
                they bought, and the copy has to have said so first.
              */}
              {interpolate(t.unsubscribe.body, {
                shop: shop.name,
                email: claim.email,
              })}
            </p>

            <UnsubscribeForm
              action={confirmUnsubscribe}
              token={token}
              label={t.unsubscribe.confirm}
              doneTitle={t.unsubscribe.doneTitle}
              doneBody={interpolate(t.unsubscribe.doneBody, { shop: shop.name })}
            />
          </>
        )}
      </div>
    </div>
  );
}
