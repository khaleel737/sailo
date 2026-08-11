import { AlertTriangle, BadgeCheck, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { startPartnerConnect } from "@/lib/actions/partner-program";
import type { PartnerConnectState } from "@/lib/partners/connect";
import { CountrySelect } from "./country-select";

/**
 * Where the money lands.
 *
 * Five states, and each one gets a different sentence because each has a
 * different next action — "verifying" and "not connected" look similar and
 * mean completely different things to somebody sitting on a balance.
 *
 * The onboarding button is a server action that redirects, not a link:
 * account links are single-use and expire in minutes, so one is minted per
 * press rather than rendered into the page and left to go stale.
 */
export function ConnectPanel({
  state,
  country,
  availableCents,
  currency,
}: {
  state: PartnerConnectState;
  country: string | null;
  availableCents: number;
  currency: string;
}) {
  if (state === "active") {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4">
        <BadgeCheck className="mt-0.5 size-5 shrink-0 text-emerald-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-900">
            You&rsquo;re set up to get paid
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-emerald-800">
            Payouts go to the bank account on your Stripe profile
            {country ? ` (${country})` : ""}. Transfers to partner accounts take
            about a day longer than a normal Stripe payout to land.
          </p>
        </div>
      </div>
    );
  }

  if (state === "unsupported_country") {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            We can&rsquo;t transfer to {country ?? "your country"} automatically
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-amber-800">
            Stripe doesn&rsquo;t support cross-border transfers between our
            country and yours. You still earn normally — email us and
            we&rsquo;ll settle your balance another way.
          </p>
        </div>
      </div>
    );
  }

  if (state === "verifying") {
    return (
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4">
        <Clock className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            Stripe is still verifying you
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-amber-800">
            This usually takes a few minutes but can take a day. Your earnings
            keep accruing either way — nothing is lost while you wait.
          </p>
          <form action={startPartnerConnect} className="mt-3">
            <Button type="submit" variant="secondary" size="sm">
              Check or finish setup
              <ExternalLink className="size-3.5" />
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const resuming = state === "onboarding";

  return (
    <div className="mt-6 rounded-2xl border border-ink-200 p-4">
      <p className="text-sm font-medium text-ink-900">
        {resuming ? "Finish setting up payouts" : "Set up how you get paid"}
      </p>
      <p className="mt-0.5 text-sm leading-relaxed text-ink-600">
        {resuming
          ? "You started this but didn't finish — Stripe still needs a few details before we can send you anything."
          : "Connect a Stripe account so we can pay your commission straight to your bank. It only ever receives money; you're not signing up to take payments."}
        {availableCents > 0 ? (
          <>
            {" "}
            <span className="font-medium text-ink-900">
              You have {formatMoney(availableCents, currency)} waiting.
            </span>
          </>
        ) : null}
      </p>

      <form action={startPartnerConnect} className="mt-3 flex flex-wrap items-end gap-2">
        {/*
          Asked rather than geolocated: the country decides which bank details
          Stripe collects and which agreement is even available, and reading it
          off an IP address would strand anyone onboarding from an airport.
          Only on the first pass — once the account exists the country is fixed.
        */}
        {resuming ? null : <CountrySelect />}
        <Button type="submit">
          {resuming ? "Continue with Stripe" : "Connect with Stripe"}
          <ExternalLink className="size-3.5" />
        </Button>
      </form>
    </div>
  );
}
