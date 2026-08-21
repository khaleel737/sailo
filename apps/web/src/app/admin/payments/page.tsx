import { LearnMore } from "@/app/admin/_components/learn-more";
import { docsUrl } from "@sailo/core/origin";
import type { Metadata } from "next";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  MessageCircle,
  Wallet,
} from "lucide-react";
import { redirect } from "next/navigation";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopPaymentMethods } from "@/lib/queries";
import {
  isConfigured,
  isRailAvailable,
  PAYMENT_METHOD_LIST,
  type PaymentCategory,
} from "@/lib/payments";
import { PageHeader } from "@sailo/design-system/web";
import { PaymentMethodCard } from "@/app/admin/payments/_components/payment-method-card";
import { PayoutCard } from "@/app/admin/payments/_components/payout-card";
import { StripeCard } from "@/app/admin/payments/_components/stripe-card";
import { DisputesCard } from "@/app/admin/payments/_components/disputes-card";
import { getSellerDisputes } from "@/lib/seller-disputes";
import { Alert, Badge } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { startOnboarding, syncAccount } from "@sailo/commerce/orders/server";

export const metadata: Metadata = { title: "Payments" };

/**
 * The four families of rail, in the order a seller cares about them: the one
 * that settles itself, the payment apps the buyer taps through, the ones they
 * arrange out of their own account, and the one that hands the whole
 * conversation over.
 *
 * `category` on the rail definition decides membership — see `PaymentCategory`
 * for why that is a different question from `kind`. Adding a rail puts it in a
 * section here without touching this file.
 */
const SECTIONS = [
  { key: "online", icon: CreditCard, title: "payOnline", body: "payOnlineBody" },
  { key: "wallet", icon: Wallet, title: "wallets", body: "walletsBody" },
  { key: "manual", icon: Banknote, title: "manual", body: "manualBody" },
  { key: "chat", icon: MessageCircle, title: "chatHandoff", body: "chatHandoffBody" },
] as const satisfies readonly {
  key: PaymentCategory;
  icon: typeof Wallet;
  title: string;
  body: string;
}[];

function SectionHeading({
  icon: Icon,
  title,
  description,
  live,
  total,
  liveLabel,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
  live: number;
  total: number;
  /** Pre-interpolated, because this is a server component with no dictionary. */
  liveLabel: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-3">
      {/*
        The icon carries the section on a scan of the page, so it gets a tile
        of its own rather than sitting inline at text size — the same tile the
        rail rows below it use, so the two read as one column.
      */}
      <span
        className={
          live > 0
            ? "flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700"
            : "flex size-9 shrink-0 items-center justify-center rounded-xl border border-ink-200 bg-ink-50 text-ink-400"
        }
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {live > 0 ? (
            <Badge tone="green" dot>
              {liveLabel}
            </Badge>
          ) : (
            // Not a red badge: a section nobody has switched on is the normal
            // state of most of this page, not a fault to be shouted about.
            <span className="text-xs text-ink-400">{total}</span>
          )}
        </div>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-ink-500">
          {description}
        </p>
      </div>
    </div>
  );
}

export default async function AdminPaymentsPage({
  searchParams,
}: PageProps<"/admin/payments">) {
  let { shop } = await requireShop("settings:read");
  const { a } = await getAdminT();
  const params = await searchParams;

  // Coming back from Stripe's onboarding proves nothing on its own — Stripe
  // decides separately whether the account may take charges — so re-read it.
  if (params.stripe === "return" && shop.stripeAccountId) {
    await syncAccount(shop);
    ({ shop } = await requireShop("settings:read"));
  }

  /*
   * Stripe bounced the seller back because their onboarding link expired or was
   * already spent — account links are single-use and die within minutes. Its
   * whole contract (see `OnboardingRedirects.refreshUrl`) is to *restart* the
   * flow, not to render a page: left to fall through, a seller who left
   * onboarding half-finished dead-ends on Stripe's "this page didn't load"
   * error with a `?stripe=refresh` URL and no way forward. So mint a fresh link
   * here and send them straight back into onboarding, no second click.
   *
   * Only when an account already exists. A refresh without one would have
   * `connectOnboardingLink` *create* an account at this GET, skipping the
   * country dropdown and the restricted-business screen the Connect button runs
   * first; Stripe has no account to refresh in that state anyway, so the
   * fall-through renders the Connect card for a clean start instead.
   *
   * `redirect` is deliberately outside the try — it signals by throwing, so
   * catching it would swallow the redirect. A genuine Stripe failure is caught
   * and the page renders the Connect card for a manual retry rather than a Next
   * error screen.
   */
  if (params.stripe === "refresh" && shop.stripeAccountId) {
    let link: string | null = null;
    try {
      ({ url: link } = await startOnboarding(shop));
    } catch (error) {
      console.error("[sailo] Stripe onboarding refresh failed:", error);
    }
    if (link) redirect(link);
  }

  const [methods, disputes] = await Promise.all([
    getShopPaymentMethods(shop.id),
    /*
     * Read alongside the rails rather than after them. Neither needs the
     * other's answer, and this page is already three round trips deep.
     */
    getSellerDisputes(shop.id),
  ]);
  const byType = new Map(methods.map((m) => [m.type, m]));

  const isLive = (type: string) => {
    const method = byType.get(type);
    return (
      Boolean(method?.isEnabled) &&
      isConfigured(type, method?.config ?? {}) &&
      // A rail the shop's currency rules out is not one of its ways to order,
      // however enabled the row says it is.
      isRailAvailable(type, shop.currency)
    );
  };

  /*
   * Counted over everything *except* card, which is counted separately below
   * from Stripe's own verdict. Counting the full list double-counted it —
   * `refreshStripeAccount` writes an enabled `card` row the moment Stripe
   * clears the account, so a shop with card and WhatsApp live read "3 ways to
   * order" with two on screen.
   */
  const cardLive = shop.stripeChargesEnabled;
  const totalLive =
    PAYMENT_METHOD_LIST.filter((d) => d.type !== "card" && isLive(d.type)).length +
    (cardLive ? 1 : 0);

  return (
    <>
      <PageHeader
        title={a.payments.title}
        description={a.payments.description}
        meta={
          totalLive > 0 ? (
            <Badge tone="green" dot>
              {totalLive === 1
                ? a.payments.waysToOrderOne
                : interpolate(a.payments.waysToOrder, { count: totalLive })}
            </Badge>
          ) : (
            <Badge tone="red" dot>
              {a.payments.nothingLive}
            </Badge>
          )
        }
      />

      {/*
        Stripe refused to start onboarding. Shown verbatim: Stripe writes these
        for people to read, and the alternative — a Next error page over the
        admin — tells the seller nothing and us less.
      */}
      {params.stripe === "error" ? (
        <Alert
          tone="error"
          title={a.payments.stripeErrorTitle}
          icon={<AlertTriangle className="size-5" />}
          className="mb-6"
        >
          {typeof params.reason === "string"
            ? params.reason
            : a.payments.stripeNoResponse}
        </Alert>
      ) : null}

      {/*
        Reached only by a Connect request that arrived without a country — the
        form requires one, so in practice this is a direct POST. Worth a real
        message rather than a Stripe error, because it is the single thing on
        this page that must be right before an account exists.
      */}
      {params.stripe === "country" ? (
        <Alert
          tone="warning"
          icon={<AlertTriangle className="size-5" />}
          className="mb-6"
        >
          {a.payments.businessCountryMissing}
        </Alert>
      ) : null}

      {totalLive === 0 ? (
        <Alert
          tone="warning"
          title={a.payments.nobodyCanOrder}
          icon={<AlertTriangle className="size-5" />}
          className="mb-6"
        >
          {a.payments.nobodyCanOrderBody}
        </Alert>
      ) : null}

      {SECTIONS.map((section) => {
        const rails = PAYMENT_METHOD_LIST.filter((d) => d.category === section.key);
        // Card is the one rail configured by connecting an account rather than
        // by filling in fields, so its section shows the Connect card instead
        // of a form — and counts Stripe's verdict rather than a stored row.
        const live =
          section.key === "online"
            ? cardLive
              ? 1
              : 0
            : rails.filter((d) => isLive(d.type)).length;

        return (
          <section key={section.key} className="mb-8 last:mb-0">
            <SectionHeading
              icon={section.icon}
              title={a.payments[section.title]}
              description={a.payments[section.body]}
              live={live}
              total={rails.length}
              liveLabel={interpolate(a.payments.liveCount, { count: live })}
            />
            <div className="space-y-3">
              {section.key === "online" ? (
                <>
                  <StripeCard shop={shop} />
                  {/* Balance, payouts and account health — only once an
                      account exists. */}
                  <PayoutCard shop={shop} />
                </>
              ) : (
                rails.map((def) => (
                  <PaymentMethodCard
                    key={def.type}
                    def={def}
                    method={byType.get(def.type)}
                    currency={shop.currency}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}

      {/*
        Chargebacks, last.

        Below the rails on purpose: this page's job is getting a seller paid, and
        a panel about money going *back* belongs after the ones about it coming
        in. It renders nothing at all for the large majority who have never had
        one — see `DisputesCard`.
      */}
      <DisputesCard
        disputes={disputes}
        payoutsPausedAt={shop.payoutsPausedAt}
        a={a}
      />

      <LearnMore topic={a.payments.title} href={docsUrl("/guides/payments")} />
    </>
  );
}
