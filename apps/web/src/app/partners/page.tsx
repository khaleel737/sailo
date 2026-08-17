import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Clock,
  Infinity as InfinityIcon,
  Link2,
  Wallet,
} from "lucide-react";
import { getSession } from "@/lib/session";
import { getPartnerForUser } from "@sailo/partners/applications";
import { getPartnerPayouts } from "@sailo/partners/payouts";
import {
  getPartnerShop,
  getPartnerSummary,
  getReferredCreators,
} from "@sailo/partners/store";
import { getProgramSettings } from "@sailo/partners/settings";
import { hasLiveSubscription, payoutBlocker } from "@sailo/partners/eligibility";
import { referralUrl, resolveCommissionBp, shareLabel } from "@sailo/partners/program";
import { PLANS } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";
import { ApplyForm } from "./_components/apply-form";
import { ConnectPanel } from "./_components/connect-panel";
import { PartnerStats } from "./_components/partner-stats";

/**
 * The Sailo partner programme — our own acquisition channel.
 *
 * Not to be confused with `/partner/[token]`, which is a *seller's* affiliate
 * looking at commission that seller owes them for selling their products. This
 * page is about Sailo paying somebody for bringing us a creator, out of the
 * subscription that creator pays us. The two are one letter apart in the URL
 * and nothing alike in the money they move.
 *
 * One route for four states, rather than a landing page that redirects to a
 * dashboard. Whoever arrives here — a stranger from a tweet, an applicant
 * refreshing for a decision, an approved partner fetching their link — is
 * asking the same question ("what is this and where do I stand"), and the
 * answer is just further down the page for some of them than others.
 */

export const instant = false;

export const metadata: Metadata = {
  title: "Partner programme",
  description:
    "Earn recurring commission for every creator you bring to Sailo, for as long as they stay.",
};

export default async function PartnersPage() {
  const settings = await getProgramSettings();
  const session = await getSession();
  const user = session?.user;

  const partner = user ? await getPartnerForUser(user.id) : null;
  const commissionBp = resolveCommissionBp(
    partner?.commissionBp,
    settings.commissionBp,
  );
  const share = shareLabel(commissionBp);

  /*
   * The one state that has data to load, narrowed to a value rather than left
   * as a boolean flag. A flag would leave `partner` still nullable everywhere
   * below, and the whole rendering path for an approved partner would be
   * written against assertions that the type system had no reason to believe.
   */
  const live =
    partner && partner.status === "approved" && partner.code
      ? { ...partner, code: partner.code }
      : null;

  const [summary, referrals, payouts, shop] = live
    ? await Promise.all([
        getPartnerSummary(live.id, settings.payoutMinimumCents),
        getReferredCreators(live.id),
        getPartnerPayouts(live.id),
        /*
         * Their shop answers both questions this page asks about money: it
         * carries the subscription that lets them accrue, and the Stripe
         * account the commission is transferred into. There is no partner-side
         * Stripe state left to read.
         */
        getPartnerShop(live.shopId),
      ])
    : [null, [], [], null];

  const currency = summary?.currency ?? "USD";

  /*
   * The pitch, in the only terms that matter to somebody deciding where to
   * point an audience: what one referral actually pays, per month, forever.
   * Computed from the live rate and the live plan prices so the page cannot
   * quote a number the ledger disagrees with.
   */
  const perPlan = [
    { name: PLANS.pro.name, monthly: PLANS.pro.monthlyCents },
    { name: PLANS.business.name, monthly: PLANS.business.monthlyCents },
  ].map((plan) => ({
    ...plan,
    cut: Math.floor((plan.monthly * commissionBp) / 10_000),
  }));

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-3xl px-5 pb-24 pt-14">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Sailo partners
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl">
          Earn {share} of every creator you bring us — every month, for as long
          as they stay.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-600">
          Share your link. When someone signs up through it and starts paying
          for Sailo, you keep {share} of what they pay us. There&rsquo;s no cap,
          no expiry, and no requirement to sell on Sailo yourself.
        </p>

        {/* What it actually pays, in money rather than percentages. */}
        <dl className="mt-8 grid gap-3 sm:grid-cols-3">
          {perPlan.map((plan) => (
            <div key={plan.name} className="rounded-2xl border border-ink-100 p-4">
              <dt className="text-xs font-medium text-ink-500">
                Every {plan.name} referral
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
                {formatMoney(plan.cut, "USD")}
                <span className="text-sm font-normal text-ink-500">/mo</span>
              </dd>
            </div>
          ))}
          <div className="rounded-2xl border border-ink-100 p-4">
            <dt className="text-xs font-medium text-ink-500">For how long</dt>
            <dd className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-ink-900">
              <InfinityIcon className="size-6 text-brand-700" />
              <span className="text-sm font-normal text-ink-500">
                as long as they stay
              </span>
            </dd>
          </div>
        </dl>

        <ul className="mt-6 grid gap-2.5 text-sm text-ink-600 sm:grid-cols-2">
          <Term icon={<Link2 className="size-4" />}>
            {settings.cookieDays}-day attribution window on every click
          </Term>
          <Term icon={<Clock className="size-4" />}>
            {settings.holdDays}-day hold, so refunds settle before we pay
          </Term>
          <Term icon={<Wallet className="size-4" />}>
            Paid out once you clear{" "}
            {formatMoney(settings.payoutMinimumCents, "USD")}
          </Term>
          <Term icon={<Banknote className="size-4" />}>
            Straight to your bank through Stripe
          </Term>
        </ul>

        {/* ---- Where this particular visitor stands ------------------------ */}

        <div className="mt-10 border-t border-ink-100 pt-10">
          {!user ? (
            <SignedOut />
          ) : !partner ? (
            <ApplyForm
              name={user.name}
              accepting={settings.acceptingApplications}
              share={share}
            />
          ) : partner.status === "pending" ? (
            <Waiting />
          ) : !live || !summary ? (
            /*
             * Rejected, suspended, or approved-but-codeless — the last of which
             * `partners_approved_has_code` makes impossible, so this branch is
             * reached only by the first two. Falling through to here rather
             * than testing the two statuses by name means a status added later
             * lands somewhere honest instead of rendering an empty link.
             */
            <Stopped status={partner.status} note={partner.reviewNote} />
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink-900">Your link</h2>
              <p className="mt-1 text-sm text-ink-600">
                Everyone who signs up through this is yours, permanently.
              </p>

              <PartnerStats
                url={referralUrl(live.code)}
                summary={summary}
                currency={currency}
                minimumCents={settings.payoutMinimumCents}
                holdDays={settings.holdDays}
              />

              <ConnectPanel
                blocker={payoutBlocker(shop)}
                subscribed={hasLiveSubscription(shop)}
                country={shop?.stripeAccountCountry ?? null}
                availableCents={summary.availableCents}
                currency={currency}
              />

              {/* Who you brought. Names only — a partner is owed a truthful
                  account of what they earned and nothing beyond it. */}
              <section className="mt-10">
                <h2 className="text-lg font-semibold text-ink-900">
                  Creators you brought
                </h2>
                {referrals.length === 0 ? (
                  <p className="mt-3 rounded-2xl bg-ink-50 p-6 text-center text-sm text-ink-500">
                    Nobody yet. Your link is above.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-ink-100 rounded-2xl border border-ink-100">
                    {referrals.map((row) => (
                      <li
                        key={row.shopHandle}
                        className="flex items-center gap-3 p-3.5"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink-900">
                            {row.shopName}
                          </span>
                          <span className="block text-xs text-ink-500">
                            Joined{" "}
                            {row.attributedAt.toLocaleDateString("en", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                            {row.convertedAt ? " · paying" : " · on free"}
                          </span>
                        </span>
                        <span className="text-end">
                          <span className="block text-sm font-semibold tabular-nums text-ink-900">
                            {formatMoney(row.earnedCents, row.currency ?? currency)}
                          </span>
                          <span className="block text-xs text-ink-400">earned</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* What we've sent, including what failed and why. */}
              {payouts.length > 0 ? (
                <section className="mt-10">
                  <h2 className="text-lg font-semibold text-ink-900">Payouts</h2>
                  <ul className="mt-3 divide-y divide-ink-100 rounded-2xl border border-ink-100">
                    {payouts.map((row) => (
                      <li key={row.id} className="flex items-center gap-3 p-3.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-ink-900">
                            {formatMoney(row.amountCents, row.currency)}
                          </span>
                          <span className="block text-xs text-ink-500">
                            {(row.paidAt ?? row.createdAt).toLocaleDateString("en", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                            {row.status === "failed" && row.failureReason
                              ? ` · ${row.failureReason}`
                              : ""}
                          </span>
                        </span>
                        <PayoutBadge status={row.status} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        {settings.terms ? (
          <section className="mt-12 border-t border-ink-100 pt-8">
            <h2 className="text-sm font-semibold text-ink-900">Programme terms</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">
              {settings.terms}
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Term({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-brand-700">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function SignedOut() {
  return (
    <div className="rounded-2xl bg-ink-50 p-6">
      <h2 className="text-lg font-semibold text-ink-900">Apply in a minute</h2>
      <p className="mt-1 text-sm text-ink-600">
        You&rsquo;ll need a Sailo account to hold your link and your earnings —
        it&rsquo;s free, and you don&rsquo;t have to open a shop.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/signup?next=/partners"
          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-xl pointer-coarse:h-11 bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800"
        >
          Create an account
          <ArrowRight className="size-4" />
        </Link>
        <Link
          href="/login?next=/partners"
          className="focus-ring inline-flex h-10 items-center rounded-xl pointer-coarse:h-11 border border-ink-200 px-4 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
        >
          I already have one
        </Link>
      </div>
    </div>
  );
}

function Waiting() {
  return (
    <div className="rounded-2xl bg-amber-50 p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-900">
        <Clock className="size-5" />
        Application received
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-amber-800">
        We read every one by hand. You&rsquo;ll get an email as soon as
        there&rsquo;s a decision, and your link will appear right here.
      </p>
    </div>
  );
}

/**
 * Declined or stopped.
 *
 * The reason is shown when there is one, because a rejection with no reason is
 * a support ticket we will answer by hand later anyway. `notes` — HQ's private
 * scratchpad — is deliberately not read here.
 */
function Stopped({ status, note }: { status: string; note: string | null }) {
  return (
    <div className="rounded-2xl bg-ink-50 p-6">
      <h2 className="text-lg font-semibold text-ink-900">
        {status === "suspended"
          ? "Your partner account is on hold"
          : "We couldn't approve this application"}
      </h2>
      {note ? (
        <p className="mt-1 text-sm leading-relaxed text-ink-600">{note}</p>
      ) : (
        <p className="mt-1 text-sm leading-relaxed text-ink-600">
          Reply to any email from us if you&rsquo;d like us to take another look.
        </p>
      )}
    </div>
  );
}

function PayoutBadge({ status }: { status: string }) {
  const tone =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";

  const label =
    status === "paid" ? "Sent" : status === "failed" ? "Failed" : "On its way";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      {status === "paid" ? <BadgeCheck className="size-3.5" /> : null}
      {label}
    </span>
  );
}
