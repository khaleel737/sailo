import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { PartnerSignIn } from "@/app/partner/_components/partner-sign-in";
import { getT } from "@/i18n/server";

/* Not yet converted — see the note in `next.config.ts`. */
export const instant = false;


export const metadata: Metadata = {
  title: "Find your referral report",
  robots: { index: false, follow: false },
};

/**
 * The way back in when an affiliate loses their link.
 *
 * There's no password because there's no account — the report lives behind an
 * unguessable token, and this posts one out by email. It never says whether an
 * address is registered, so it can't be used to probe who promotes a shop.
 */
export default async function PartnerSignInPage() {
  const { locale, t, dir } = await getT();

  return (
    <div
      data-surface="light"
      dir={dir}
      lang={locale}
      className="flex min-h-screen items-center justify-center px-4 py-16"
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="surface-elevated mb-3 flex size-11 items-center justify-center rounded-full">
            <Gift className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {t.partner.signInTitle}
          </h1>
          <p className="text-muted mt-1.5 text-sm leading-relaxed">
            {t.partner.signInBody}
          </p>
        </div>

        <PartnerSignIn
          emailLabel={t.partner.signInEmail}
          action={t.partner.signInAction}
          done={t.partner.signInDone}
        />
      </div>
    </div>
  );
}
