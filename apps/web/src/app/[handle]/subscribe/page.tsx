import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShopByHandle } from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { shopThemeVars } from "@/lib/utils";
import { absolute } from "@/lib/seo";
import { SubscribeCard } from "../_components/subscribe-card";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * The page a seller puts in their bio.
 *
 * Its own address rather than only a card on the storefront, because the
 * places a mailing list actually grows are the places a shop page is not: a
 * link in an Instagram profile, a QR code on a receipt, a line in a video
 * description. Those need something short to point at that asks one question
 * and nothing else — a storefront full of products is a page where the signup
 * is the fourth thing you see.
 *
 * It works whether or not the seller has switched the storefront card on.
 * Turning the card off is a decision about their shop page's layout, not a
 * decision to stop taking subscribers, and a link they have already printed
 * must not quietly break.
 */

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/subscribe">): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) return { title: "Shop not found" };

  const { t } = await getShopT(shop.locale);
  return {
    title: { absolute: `${t.mailing.title} · ${shop.name}` },
    description: interpolate(t.mailing.body, { shop: shop.name }),
    alternates: { canonical: absolute(`/${shop.handle}/subscribe`) },
  };
}

export default async function SubscribePage({
  params,
}: PageProps<"/[handle]/subscribe">) {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop) notFound();

  const { t, locale, dir } = await getShopT(shop.locale);

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[440px] px-4 py-16 sm:py-24">
        <SubscribeCard
          standalone
          handle={shop.handle}
          incentive={shop.subscribeIncentive}
          labels={{
            title: t.mailing.title,
            body: interpolate(t.mailing.body, { shop: shop.name }),
            emailLabel: t.mailing.emailLabel,
            nameLabel: t.mailing.nameLabel,
            cta: t.mailing.cta,
            checkInbox: t.mailing.checkInbox,
            privacyNote: t.mailing.privacyNote,
            optional: t.common.optional,
          }}
        />

        {/* The way back to what they were being asked to subscribe to. A
            bio link lands here cold, and a page with no exit to the shop
            spends the visit on an address instead of a sale. */}
        <Link
          href={`/${shop.handle}`}
          className="focus-ring-accent mt-8 inline-flex text-sm font-medium underline underline-offset-4 opacity-70 transition hover:opacity-100"
        >
          {shop.name}
        </Link>
      </div>
    </div>
  );
}
