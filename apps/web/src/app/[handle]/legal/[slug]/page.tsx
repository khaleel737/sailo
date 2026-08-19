import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { renderBody } from "@sailo/marketing/broadcasts";
import { absolute } from "@sailo/core/origin";
import { isLegalPageKind } from "@sailo/core/shop-pages";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { getPublishedPage, getShopByHandle } from "@/lib/queries";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { isShopLive } from "@sailo/core/visibility";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * One of the seller's own documents. Spec 41.
 *
 * `/[handle]/legal/[slug]` rather than `/[handle]/[slug]`, and the reason is a
 * collision that would otherwise be silent: `/[handle]/p/[slug]` is the product
 * route, and a flat page slug would sit beside the shop's own catalogue in the
 * same namespace. Nesting under a static segment means a seller can call a page
 * anything without discovering they have shadowed something.
 *
 * ## The document renders on paper, whatever the storefront's theme is
 *
 * The markdown pipeline (`broadcasts/markdown.ts`) styles every tag inline,
 * including `color`, because an email client applies no stylesheet of its own.
 * That is right for an inbox and it means the rendered HTML carries dark ink —
 * so a shop on the dark theme would render this document unreadably. It is
 * therefore given a light panel of its own rather than being reskinned, which
 * also happens to be what a legal document should look like.
 *
 * The sanitiser is the point of reusing that pipeline at all. This is
 * seller-authored, HTML-adjacent content on a public page, which is the same
 * threat as a broadcast body and is already handled there.
 */

export async function generateMetadata({
  params,
}: PageProps<"/[handle]/legal/[slug]">): Promise<Metadata> {
  const { handle, slug } = await params;
  const shop = await getShopByHandle(handle);
  if (!shop || !isShopLive(shop)) return { title: "Not found" };

  const page = await getPublishedPage(shop.id, slug);
  if (!page) return { title: "Not found" };

  return {
    title: { absolute: `${page.title ?? slug} · ${shop.name}` },
    alternates: { canonical: absolute(`/${shop.handle}/legal/${page.slug}`) },
    /*
     * Indexed, deliberately. A shop's refund policy is one of the pages a buyer
     * searches for by name before they buy, and `noindex` here would hide the
     * document from exactly the person it is written for.
     */
  };
}

export default async function ShopLegalPage({
  params,
}: PageProps<"/[handle]/legal/[slug]">) {
  const { handle, slug } = await params;

  const shop = await getShopByHandle(handle);
  // Same answer as a shop that never existed — an unpublished storefront must
  // not leak that it is somebody's.
  if (!shop || !isShopLive(shop)) notFound();

  const page = await getPublishedPage(shop.id, slug);
  if (!page) notFound();

  const { t, locale, dir } = await getShopT(shop.locale);
  const html = renderBody(page.bodyMd ?? "");

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:py-16">
        <Link
          href={`/${shop.handle}`}
          className="focus-ring-accent inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 opacity-70 transition hover:opacity-100"
        >
          {interpolate(t.pages.visitShop, { shop: shop.name })}
        </Link>

        <article className="mt-6 rounded-2xl bg-white p-6 text-ink-900 shadow-sm sm:p-10">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            {page.title ?? page.slug}
          </h1>

          {/*
            The document itself, in the one language it was written in.
            `lang="en"` on the article rather than on the page: the chrome above
            and below is translated and the body is not, and telling a screen
            reader or a browser translator otherwise would have it read English
            prose with the wrong phonetics.
          */}
          <div
            lang="en"
            dir="ltr"
            className="mt-5"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {/*
            Not optional and not dismissible — and only on the three documents
            that carry a legal claim. On an About page or an FAQ it would be a
            disclaimer about the seller's own words, which is noise.
          */}
          {isLegalPageKind(page.kind) ? (
            <p className="mt-8 border-t border-ink-100 pt-4 text-xs leading-relaxed text-ink-500">
              {t.pages.disclaimer}
            </p>
          ) : null}
        </article>
      </div>
    </div>
  );
}
