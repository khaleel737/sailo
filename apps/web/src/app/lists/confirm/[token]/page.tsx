import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { contactLists, shops } from "@sailo/db/schema";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { readListConfirmToken } from "@sailo/marketing/contacts/server";
import { ListConfirmForm } from "@/components/shared/list-confirm-form";
import { shopThemeVars } from "@sailo/design-system/web/cn";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * The page a list confirmation link opens — rule 6, made real.
 *
 * A `pending` member with no way to confirm is a dead end, and a list that
 * silently never reaches half the people on it is worse than one that never
 * asked. This is the other half of `joinList`.
 *
 * Deliberately the same shape as `/s/[token]` and `/u/[token]`: no login, no
 * cookie, everything carried in a signed token, and a button rather than an
 * action on load.
 *
 * It reuses the storefront's existing `mailing` strings rather than adding its
 * own. Not laziness — `dictionaries/*.ts` are typed as the complete
 * `Dictionary`, so a new storefront key is a compile error in all 34 locales
 * until every one is filled, and the sentence this page needs is the sentence
 * that file already has: *this shop may now email you*. Which list is named
 * above it, where the shop's own words belong.
 */
export const metadata: Metadata = {
  title: "Confirm",
  robots: { index: false, follow: false },
};

export default async function ConfirmListJoinPage({
  params,
}: PageProps<"/lists/confirm/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding threw on a bare `%`.
  const claim = readListConfirmToken(token);

  /*
   * Both loaded together, and a missing list is as dead as a missing shop: a
   * seller who deleted the list between sending the invitation and this click
   * has nothing left to add anybody to, and saying so as "this link has
   * expired" is both true and free of any claim about what the list contained.
   */
  const [shop, list] = claim
    ? await Promise.all([
        getDb().query.shops.findFirst({ where: eq(shops.id, claim.shopId) }),
        getDb().query.contactLists.findFirst({
          where: eq(contactLists.id, claim.listId),
          columns: { id: true, name: true, shopId: true },
        }),
      ])
    : [null, null];

  /*
   * The list must belong to the shop the token names. Both come out of one
   * signed payload, so this cannot currently disagree — and it is checked
   * anyway, because the day somebody adds a second way to mint one of these
   * is the day that stops being true.
   */
  const valid = claim && shop && list && list.shopId === shop.id;

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
        {!valid ? (
          <>
            <h1 className="text-xl font-bold">{t.mailing.expiredTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.mailing.expiredBody}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t.mailing.confirmTitle}</h1>
            {/* The seller's own words for the group, above the shop's promise. */}
            <p className="mt-1 text-sm font-medium">{list.name}</p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {interpolate(t.mailing.confirmBody, { shop: shop.name })}
            </p>

            <ListConfirmForm
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
