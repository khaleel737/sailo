import type { Metadata } from "next";
import { readNewsletterToken } from "@sailo/marketing/newsletter/server";
import { getBlogDictionary } from "@sailo/i18n/marketing/blog";
import { directionOf, DEFAULT_LOCALE } from "@sailo/i18n/config";
import { Container } from "@/components/marketing/kit";
import { NewsletterConfirmForm } from "./_components/confirm-form";

/*
 * Reads a signed token off the URL, so there is nothing to prerender — every
 * visit is a different claim. `instant = false` says so rather than leaving the
 * build to complain about it.
 */
export const instant = false;

/**
 * The page the confirmation link opens — the moment an address becomes a
 * subscriber.
 *
 * Deliberately the same shape as `/s/[token]`, its shop-side counterpart, and
 * as `/u/marketing/[token]`, its opposite number: no login, no cookie,
 * everything it needs carried in a signed token, and a button rather than an
 * action on load. The symmetry is the point — joining a list and leaving one
 * should cost the same single tap and prove the same single thing, that the
 * person holds the address.
 *
 * A single segment (`/n/`) so it can never collide with a shop handle: handles
 * have a minimum length, which is what already protects `/s`, `/u` and `/r`.
 */
export const metadata: Metadata = {
  title: "Confirm your subscription",
  // A page reached only from a link in an email, holding a signed token. There
  // is nothing here for an index, and the token should not be in one.
  robots: { index: false, follow: false },
};

export default async function ConfirmNewsletterPage({
  params,
}: PageProps<"/n/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding throws on a bare `%`.
  const claim = readNewsletterToken(token);

  /*
   * The reader's own language, taken from the token rather than from a cookie.
   *
   * They clicked this link in a mail client, often on a different device from
   * the one they subscribed on — so the cookie that would normally carry a
   * language preference is very likely absent. The claim knows which article
   * they were reading, and that is the better answer.
   */
  const locale = claim?.locale ?? DEFAULT_LOCALE;
  const b = getBlogDictionary(locale);

  return (
    <div className="brand-surface min-h-screen" lang={locale} dir={directionOf(locale)}>
      <Container className="max-w-[30rem] py-20 sm:py-28">
        {!claim ? (
          <>
            <h1 className="display-sm text-[1.75rem] leading-tight text-[var(--ink)]">
              {b.expiredTitle}
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-[1.7] text-[var(--mute-600)]">
              {b.expiredBody}
            </p>
          </>
        ) : (
          <>
            <h1 className="display-sm text-[1.75rem] leading-tight text-[var(--ink)]">
              {b.confirmTitle}
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-[1.7] text-[var(--mute-600)]">
              {b.confirmBody}
            </p>
            <NewsletterConfirmForm
              token={token}
              label={b.confirmCta}
              doneTitle={b.confirmedTitle}
              doneBody={b.confirmedBody}
            />
          </>
        )}
      </Container>
    </div>
  );
}
