import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { automations, shops } from "@sailo/db/schema";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import {
  hasOptedOutOfAutomation,
  readAutomationUnsubToken,
} from "@sailo/marketing/automations/server";
import { confirmFlowUnsubscribe } from "@/lib/actions/unsubscribe";
import { UnsubscribeForm } from "@/components/shared/unsubscribe-form";
import { shopThemeVars } from "@sailo/design-system/web/cn";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * Leaving one sequence, which is not leaving the shop's list.
 *
 * The third page of this shape, after `/u/[token]` and `/s/[token]`: no login,
 * no cookie, everything in a signed token, and a button rather than an action
 * on load — because every URL in an email is prefetched by scanners, and a GET
 * that acted would stop sequences for people who never read the message.
 *
 * It reuses the storefront's existing `unsubscribe` strings. That is not
 * laziness: `dictionaries/*.ts` are typed as the complete `Dictionary`, so a
 * new key there is a compile error in all 34 locales until every one is
 * filled. What this page adds in its own words is the flow's name, which is
 * the seller's text and needs no translation.
 */
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default async function FlowUnsubscribePage({
  params,
}: PageProps<"/u/flow/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding threw on a bare `%`.
  const claim = readAutomationUnsubToken(token);

  const automation = claim
    ? await getDb().query.automations.findFirst({
        where: eq(automations.id, claim.automationId),
        columns: { id: true, name: true, shopId: true },
      })
    : null;

  const shop = automation
    ? await getDb().query.shops.findFirst({ where: eq(shops.id, automation.shopId) })
    : null;

  const { t, locale, dir } = await getShopT(shop?.locale ?? null);

  // Already out: say so plainly rather than offering a button that would do
  // nothing. Clicking twice is common and must not look like failure.
  const already =
    claim && automation
      ? await hasOptedOutOfAutomation(automation.id, claim.email)
      : false;

  return (
    <div
      data-surface={shop?.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop?.accentColor ?? "#111111")}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[420px] px-4 py-20">
        {!claim || !automation || !shop ? (
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
              {interpolate(t.unsubscribe.doneBody, { shop: automation.name })}
            </p>
          </>
        ) : (
          <>
            {/*
              The flow's name, not the shop's, in both the heading and the
              confirmation. That difference is the whole page: this stops one
              sequence, and somebody who meant to leave the shop's list
              entirely has to be able to see that they have not.
            */}
            <h1 className="text-xl font-bold">
              {interpolate(t.unsubscribe.title, { shop: automation.name })}
            </h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {interpolate(t.unsubscribe.body, {
                shop: automation.name,
                email: claim.email,
              })}
            </p>

            <UnsubscribeForm
              action={confirmFlowUnsubscribe}
              token={token}
              label={t.unsubscribe.confirm}
              doneTitle={t.unsubscribe.doneTitle}
              doneBody={interpolate(t.unsubscribe.doneBody, {
                shop: automation.name,
              })}
            />
          </>
        )}
      </div>
    </div>
  );
}
