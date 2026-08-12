import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { confirmMarketingUnsubscribe } from "@/lib/actions/unsubscribe";
import { hasOptedOut } from "@/lib/lifecycle/opt-out";
import { readMarketingOptOutToken } from "@/lib/lifecycle/unsubscribe";
import { UnsubscribeForm } from "@/components/shared/unsubscribe-form";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;

/**
 * The page the unsubscribe link in a Sailo marketing email opens.
 *
 * The twin of `/u/[token]`, which does this for a shop's broadcasts. The
 * differences are all consequences of who is speaking: there is no shop to
 * look up, so no theme to borrow and no name to interpolate, and the language
 * comes from `getT()` — the reader's own — rather than from a shop's pinned
 * locale.
 *
 * No login, no cookie, and it has to work from a cold mail client months
 * after the message was sent, so everything it needs is in the token. It
 * shows a button rather than acting on load, because a GET must never
 * unsubscribe anybody: every URL in an email gets prefetched by scanners, and
 * a page that wrote the opt-out on render would remove people who never read
 * it.
 */
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

export default async function MarketingUnsubscribePage({
  params,
}: PageProps<"/u/marketing/[token]">) {
  const { token } = await params;
  // Already decoded by the router; re-decoding throws on a bare `%`.
  const claim = readMarketingOptOutToken(token);

  const { t, locale, dir } = await getT();

  // Already off the list: say so plainly rather than offering a button that
  // would do nothing. Clicking twice is common and must not look like failure.
  const already = claim ? await hasOptedOut(claim.email) : false;

  return (
    <div dir={dir} lang={locale} className="min-h-screen">
      <div className="mx-auto w-full max-w-[420px] px-4 py-20">
        {!claim ? (
          <>
            <h1 className="text-xl font-bold">{t.unsubscribe.invalidTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.unsubscribe.sailoInvalidBody}
            </p>
          </>
        ) : already ? (
          <>
            <h1 className="text-xl font-bold">{t.unsubscribe.doneTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {t.unsubscribe.sailoDoneBody}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">{t.unsubscribe.sailoTitle}</h1>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              {/*
                Named precisely, and this is the sentence that decides whether
                somebody clicks the button or reaches for "report spam"
                instead: this stops the tips, and it does not stop an order
                notification, a receipt or a password reset. Somebody who
                unsubscribes and then sells something must still be told they
                sold it, and the copy has to have said so first.
              */}
              {interpolate(t.unsubscribe.sailoBody, { email: claim.email })}
            </p>

            <UnsubscribeForm
              action={confirmMarketingUnsubscribe}
              token={token}
              label={t.unsubscribe.confirm}
              doneTitle={t.unsubscribe.doneTitle}
              doneBody={t.unsubscribe.sailoDoneBody}
            />
          </>
        )}
      </div>
    </div>
  );
}
