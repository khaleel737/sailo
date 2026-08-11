import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { readSubscribeToken } from "@/lib/broadcasts/subscribe";
import { SubscribeConfirmForm } from "@/components/shared/subscribe-confirm-form";
import { shopThemeVars } from "@/lib/utils";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * The page the confirmation link opens — the moment an address becomes a
 * contact.
 *
 * Deliberately the same shape as `/u/[token]`, its opposite number: no login,
 * no cookie, everything it needs carried in a signed token, and a button
 * rather than an action on load. The two pages are read together, and the
 * symmetry is the point — joining a list and leaving one should cost the same
 * single tap and prove the same single thing, that the person holds the
 * address.
 */
export const metadata: Metadata = {
  title: "Confirm subscription",
  robots: { index: false, follow: false },
};

export default async function ConfirmSubscribePage({
  params,
}: PageProps<"/s/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding threw on a bare `%`.
  const claim = readSubscribeToken(token);

  const shop = claim
    ? await getDb().query.shops.findFirst({ where: eq(shops.id, claim.shopId) })
    : null;

  const { t, locale, dir } = await getShopT(shop?.locale ?? null);

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
            <h1 className="text-xl font-bold">{t.mailing.expiredTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.mailing.expiredBody}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t.mailing.confirmTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {/*
                Named precisely: this starts marketing email, and it changes
                nothing about the emails an order already sends. Somebody who
                confirms and then buys something still gets their receipt, and
                the copy has to have said so first.
              */}
              {interpolate(t.mailing.confirmBody, { shop: shop.name })}
            </p>

            <SubscribeConfirmForm
              token={token}
              label={t.mailing.confirmCta}
              doneTitle={t.mailing.confirmedTitle}
              doneBody={interpolate(t.mailing.confirmedBody, { shop: shop.name })}
            />
          </>
        )}
      </div>
    </div>
  );
}
