import Link from "next/link";
import { ArrowRight, ShieldAlert, Wallet } from "lucide-react";
import type { Shop } from "@/db/schema";
import { getCheckoutOptions } from "@/lib/queries";
import { getAdminT } from "@/i18n/server";
import { VerifyEmailBanner } from "./verify-email-banner";

/**
 * The notices that sit above every admin page.
 */
export async function StatusBanners({
  shop,
  isStaff,
  unverifiedEmail,
}: {
  shop: Shop;
  isStaff: boolean;
  /** The signed-in email, when its confirmation link is still unclicked. */
  unverifiedEmail?: string | null;
}) {
  const { a } = await getAdminT();

  /*
   * Whether a buyer could actually pay. `getCheckoutOptions` is the same
   * cached read the storefront makes, so asking here costs nothing extra and
   * — more to the point — cannot disagree with it. Counting enabled rows
   * instead would call a half-configured bank transfer a way to get paid,
   * and the seller would be told they are open while their page says
   * otherwise.
   */
  const { methods } = await getCheckoutOptions(shop.id);

  return (
    <>
      {/*
        A shop we took offline from HQ.
        Told plainly rather than left as a mystery: the seller will notice their
        link is dead within the hour either way, and the version where they
        don't know why is the version that becomes a support thread.
      */}
      {shop.suspendedAt ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-start gap-2.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p className="text-sm text-red-900">
              <span className="font-medium">{a.shell.suspended}</span>{" "}
              {shop.suspendedReason ? `${shop.suspendedReason}. ` : ""}
              Your page is offline and can&rsquo;t take orders. Reply to your
              welcome email and we&rsquo;ll look at it with you.
            </p>
          </div>
        </div>
      ) : null}

      {/*
        A shop with no way to be paid.

        This is the state every seller starts in — onboarding only seeds a rail
        when they typed a WhatsApp number — and nothing else in the admin says
        so plainly. The products page looks finished, the storefront renders,
        and the order button is simply absent, which reads as a bug rather than
        as an unfinished setup.

        Not shown to a suspended shop: that page is offline regardless, and
        stacking two alarms buries the one they can't fix themselves.

        Amber, not red. Nothing is broken — it just isn't finished yet.
      */}
      {!shop.suspendedAt && methods.length === 0 ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <Wallet className="size-4 shrink-0 text-amber-700" />
            <p dir="auto" className="flex-1 text-sm text-amber-900">
              <span className="font-medium">{a.shell.noRail}</span>{" "}
              {a.shell.noRailBody}
            </p>
            <Link
              href="/admin/payments"
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-900 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 pointer-coarse:min-h-11 min-h-9"
            >
              {a.shell.noRailCta}
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
      ) : null}

      {/*
        An address nobody has proven they own yet. Sign-up mailed the link;
        this stays until it's clicked. Suppressed for a suspended shop for the
        same reason the payments banner is — one alarm at a time.
      */}
      {!shop.suspendedAt && unverifiedEmail ? (
        <VerifyEmailBanner
          email={unverifiedEmail}
          labels={{
            title: a.shell.verifyEmail,
            body: a.shell.verifyEmailBody,
            cta: a.shell.verifyEmailCta,
            sent: a.shell.verifyEmailSent,
          }}
        />
      ) : null}

      {/*
        The way into HQ, for the two of us. A staff member's own /admin is an
        ordinary shop, so without this there is no signposted route between the
        two panels and you end up typing the URL.
      */}
      {isStaff ? (
        <div className="bg-ink-950 px-4 py-1.5 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            {/* Falls back to English until translated; `dir="auto"` keeps the
                sentence's own direction so its full stop stays at the end. */}
            <p dir="auto" className="text-xs text-white/50">
              {a.shell.staffNotice}
            </p>
            <Link
              href="/hq"
              className="focus-ring inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-white transition hover:text-brand-300 pointer-coarse:min-h-11"
            >
              {a.shell.openHq}
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
