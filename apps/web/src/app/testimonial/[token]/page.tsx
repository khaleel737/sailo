import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requestForToken } from "@sailo/marketing/testimonials/server";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { shopThemeVars } from "@sailo/design-system/web/cn";
import { PoweredBy } from "@/components/shared/powered-by";
import { TestimonialForm } from "./_components/testimonial-form";

/* A token from the URL, so there is nothing to prerender. */
export const instant = false;

/** A private link. Never something a search engine should hold on to. */
export const metadata: Metadata = {
  title: "Leave a testimonial",
  robots: { index: false, follow: false },
};

/**
 * Where somebody the seller asked writes one — spec 35.
 *
 * The link is the whole of the authorisation, so the page is careful in the two
 * ways that matters: it resolves *unused, unexpired, live shop* in one WHERE,
 * and it answers the same way for every failure. A page that distinguished
 * "already used" from "never existed" would tell whoever is trying tokens which
 * of their guesses were once real.
 */
export default async function TestimonialPage({
  params,
}: PageProps<"/testimonial/[token]">) {
  const { token } = await params;
  const found = await requestForToken(token);
  if (!found) notFound();

  const { shop } = found;
  const { t, dir } = await getShopT(shop.locale);

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen px-4 py-10"
    >
      <div className="mx-auto max-w-md space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {interpolate(t.testimonial.title, { shop: shop.name })}
          </h1>
          <p className="text-muted mt-1 text-sm">{t.testimonial.body}</p>
        </div>

        <TestimonialForm token={token} t={t} />

        <PoweredBy shop={shop} t={t} />
      </div>
    </div>
  );
}
