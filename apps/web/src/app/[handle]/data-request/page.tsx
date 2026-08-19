import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getShopByHandle } from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { isShopLive } from "@sailo/core/visibility";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { DataRequestForm } from "./_components/data-request-form";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * "Request your data" — the public end of spec 52.
 *
 * Linked from the storefront footer and from every transactional email footer,
 * because the person who needs it is a buyer with no account who may not
 * remember which shop they bought from until they are looking at it.
 *
 * The page reads **nothing**. It does not look the visitor up, it does not say
 * whether the shop has heard of them, and the form's one answer is the same
 * sentence in every case — a form that answered differently for a known and an
 * unknown address would be a customer-list oracle, which is the same finding as
 * `applyAsAffiliate` and the subscribe page, on a form whose subject is
 * precisely whether somebody is in a database.
 */

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/data-request">): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) return { title: "Not found" };

  const { t } = await getShopT(shop.locale);
  return {
    title: { absolute: `${t.dataRequest.title} · ${shop.name}` },
    /*
     * Not indexed. Nothing here is a destination a search engine should send
     * anybody to cold, and a crawler following it adds nothing.
     */
    robots: { index: false, follow: false },
  };
}

export default async function DataRequestPage({
  params,
}: PageProps<"/[handle]/data-request">) {
  const { handle } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) notFound();

  const { t, locale, dir } = await getShopT(shop.locale);

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[480px] px-4 py-16 sm:py-24">
        <h1 className="text-xl font-semibold tracking-tight">{t.dataRequest.title}</h1>
        <p className="mt-2 text-sm leading-relaxed opacity-70">
          {interpolate(t.dataRequest.body, { shop: shop.name })}
        </p>

        <DataRequestForm
          handle={shop.handle}
          labels={{
            emailLabel: t.dataRequest.emailLabel,
            kindLabel: t.dataRequest.kindLabel,
            kindAccess: t.dataRequest.kindAccess,
            kindPortability: t.dataRequest.kindPortability,
            kindErasure: t.dataRequest.kindErasure,
            cta: t.dataRequest.cta,
            received: t.dataRequest.received,
            note: t.dataRequest.note,
          }}
        />

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
