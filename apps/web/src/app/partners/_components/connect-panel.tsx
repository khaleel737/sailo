import { AlertTriangle, BadgeCheck, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";
import { formatMoney } from "@sailo/core/currency";
import type { PayoutBlocker } from "@/lib/partners/eligibility";

/**
 * Where the money lands.
 *
 * There is no partner onboarding here any more, and that is the point of the
 * whole redesign: commission goes to the Stripe account the seller already
 * connected to take payments from their own buyers. So this panel never asks
 * anyone to set anything up — it either confirms they are ready, or points at
 * the one Stripe step they already had to finish to sell at all.
 *
 * It used to be five states with its own country picker, its own onboarding
 * redirect and a hand-payment fallback. A partner who cannot be paid by Stripe
 * cannot sell on Sailo either, so none of that had a case left to serve.
 */
export function ConnectPanel({
  blocker,
  subscribed,
  country,
  availableCents,
  currency,
}: {
  blocker: PayoutBlocker | null;
  subscribed: boolean;
  country: string | null;
  availableCents: number;
  currency: string;
}) {
  const waiting =
    availableCents > 0 ? (
      <>
        {" "}
        <span className="font-medium">
          You have {formatMoney(availableCents, currency)} waiting.
        </span>
      </>
    ) : null;

  /*
   * The lapsed case is checked first and reads differently from the rest: it
   * is the only one where nothing is broken. They are still owed what they
   * earned — `payPartner` has no subscription test — they have simply stopped
   * accruing, and the fix is a billing page rather than a Stripe form.
   */
  if (!subscribed) {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            Your plan lapsed, so you&rsquo;ve stopped earning
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-amber-800">
            Commission only accrues while your Sailo subscription is active.
            Anything you already earned is still yours and still gets paid.
            {waiting}
          </p>
          <Link
            href="/admin/settings/billing"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline hover:no-underline"
          >
            Restart your plan
          </Link>
        </div>
      </div>
    );
  }

  if (blocker) {
    const copy: Record<PayoutBlocker, { title: string; body: string }> = {
      no_shop: {
        title: "You need a shop to be paid",
        body: "The partner programme pays commission into your shop's Stripe account, so there has to be one.",
      },
      no_stripe: {
        title: "Connect Stripe to get paid",
        body: "Your commission goes to the same Stripe account your shop takes payments through — the one you set up to sell. You haven't connected it yet.",
      },
      stripe_incomplete: {
        title: "Stripe is still verifying your shop",
        body: "This usually takes a few minutes but can take a day. Your commission keeps accruing either way — nothing is lost while you wait.",
      },
    };
    const { title, body } = copy[blocker];

    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4">
        <Clock className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">{title}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-amber-800">
            {body}
            {waiting}
          </p>
          <Link
            href="/admin/payments"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 underline hover:no-underline"
          >
            Open payment settings
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
      <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-emerald-900">
          You&rsquo;re set up to get paid
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-emerald-800">
          Commission goes to the same Stripe account your shop sells through
          {country ? ` (${country})` : ""}. Nothing else to set up.
        </p>
      </div>
    </div>
  );
}
