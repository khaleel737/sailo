import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowUpRight,
  MousePointerClick,
  Percent,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import { getPortalByToken } from "@/lib/affiliate-portal";
import { getShopT } from "@/i18n/server";
import { interpolate } from "@/i18n";
import { formatPercent } from "@/lib/pricing";
import { formatMoney, shopThemeVars } from "@/lib/utils";
import { CopyLink } from "@/components/admin/copy-link";

/** A private report — never something a search engine should hold on to. */
export const metadata: Metadata = {
  title: "Your referrals",
  robots: { index: false, follow: false },
};

export default async function PartnerPortalPage({
  params,
}: PageProps<"/partner/[token]">) {
  const { token } = await params;
  const data = await getPortalByToken(token);
  if (!data) notFound();

  const { affiliate, shop, stats, series, recentOrders, siblings } = data;
  const { locale, t, dir } = await getShopT(shop.locale);
  const money = (cents: number) => formatMoney(cents, shop.currency);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const referralUrl = `${base}/${shop.handle}?ref=${affiliate.code}`;
  const peak = Math.max(1, ...series.map((d) => d.commissionCents));

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      dir={dir}
      lang={locale}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-screen"
    >
      <div className="mx-auto w-full max-w-[720px] px-4 pb-20 pt-10">
        <Link
          href={`/${shop.handle}`}
          className="text-muted mb-6 inline-flex items-center gap-1.5 text-sm transition hover:opacity-70"
        >
          <Store className="size-4" />
          {shop.name}
        </Link>

        <h1 className="text-2xl font-bold leading-tight tracking-tight">
          {t.partner.title}
        </h1>
        <p className="text-muted mt-1 text-sm">
          {interpolate(t.partner.subtitle, {
            name: affiliate.name,
            shop: shop.name,
            percent: formatPercent(stats.commissionBp),
          })}
        </p>

        {/* The link itself, because this is also where they come to fetch it. */}
        <div className="surface-card mt-6 rounded-2xl p-4">
          <p className="text-muted text-xs font-medium uppercase tracking-wide">
            {t.partner.yourLink}
          </p>
          <div className="mt-2">
            <CopyLink
              url={referralUrl}
              variant="surface"
              showUrl
              copyLabel={t.checkout.copy}
              copiedLabel={t.checkout.copied}
            />
          </div>
        </div>

        {/* What they've earned. Unpaid first — it's the number they care about. */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            icon={<Wallet className="size-4" />}
            label={t.partner.unpaid}
            value={money(stats.unpaidCents)}
            accent
          />
          <Stat
            icon={<Percent className="size-4" />}
            label={t.partner.earned}
            value={money(stats.earnedCents)}
          />
          <Stat
            icon={<ShoppingBag className="size-4" />}
            label={t.partner.orders}
            value={String(stats.orderCount)}
          />
          <Stat
            icon={<MousePointerClick className="size-4" />}
            label={t.partner.clicks}
            value={String(stats.clicks)}
          />
        </div>

        <p className="text-muted mt-3 text-xs leading-relaxed">
          {stats.conversion === null
            ? t.partner.noClicksYet
            : interpolate(t.partner.conversionLine, {
                percent: stats.conversion.toFixed(1),
                orders: String(stats.orderCount),
                clicks: String(stats.clicks),
              })}
          {" "}
          {interpolate(t.partner.salesLine, { amount: money(stats.salesCents) })}
        </p>

        {/* Thirty days of commission, so a good week is visible. */}
        <section className="surface-card mt-6 rounded-2xl p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">{t.partner.last30}</h2>
            <span className="text-muted text-xs tabular-nums">
              {money(series.reduce((sum, d) => sum + d.commissionCents, 0))}
            </span>
          </div>
          <div className="mt-3 flex h-24 items-end gap-[3px]">
            {series.map((d) => (
              <div
                key={d.day}
                title={`${d.day} · ${money(d.commissionCents)}`}
                className="accent-bg flex-1 rounded-sm"
                style={{
                  height: `${Math.max(2, (d.commissionCents / peak) * 100)}%`,
                  opacity: d.commissionCents > 0 ? 1 : 0.15,
                }}
              />
            ))}
          </div>
        </section>

        {/* Every shop this person promotes, keyed off their email. */}
        {siblings.length > 1 ? (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold">{t.partner.allShops}</h2>
            <ul className="surface-card divide-y divide-black/5 rounded-2xl">
              {siblings.map((s) => (
                <li key={s.token}>
                  <Link
                    href={`/partner/${s.token}`}
                    className="flex items-center gap-3 p-3.5 transition hover:opacity-70"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {s.shopName}
                        {s.isCurrent ? (
                          <span className="text-muted font-normal">
                            {" "}
                            · {t.partner.viewing}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted block text-xs tabular-nums">
                        {formatMoney(s.earnedCents, s.currency)}{" "}
                        {t.partner.earnedLower}
                        {s.unpaidCents > 0
                          ? ` · ${formatMoney(s.unpaidCents, s.currency)} ${t.partner.unpaidLower}`
                          : ""}
                      </span>
                    </span>
                    <ArrowUpRight className="text-muted size-4 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">{t.partner.recent}</h2>
          {recentOrders.length === 0 ? (
            <p className="surface-card text-muted rounded-2xl p-6 text-center text-sm">
              {t.partner.noOrders}
            </p>
          ) : (
            <ul className="surface-card divide-y divide-black/5 rounded-2xl">
              {recentOrders.map((order) => (
                <li key={order.id} className="flex items-center gap-3 p-3.5">
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-medium">
                      {order.productTitle}
                      {order.itemCount > 1 ? (
                        <span className="text-muted font-normal">
                          {" "}
                          {interpolate(t.partner.andMore, {
                            count: String(order.itemCount - 1),
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted block text-xs">
                      {order.createdAt.toLocaleDateString(locale, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {" · "}
                      {formatMoney(order.totalCents, order.currency)}
                    </span>
                  </span>
                  <span className="text-end">
                    <span className="block text-sm font-semibold tabular-nums">
                      {formatMoney(order.commissionCents, order.currency)}
                    </span>
                    <span
                      className={`block text-xs ${
                        order.commissionPaid ? "text-emerald-600" : "text-muted"
                      }`}
                    >
                      {order.commissionPaid
                        ? t.partner.paid
                        : t.partner.awaitingPayout}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {shop.affiliateTerms ? (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold">{t.affiliate.terms}</h2>
            <p className="surface-card text-muted whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed">
              {shop.affiliateTerms}
            </p>
          </section>
        ) : null}

        <p className="text-muted mt-8 text-center text-xs leading-relaxed">
          {interpolate(t.partner.privateNote, { shop: shop.name })}
          {shop.contactEmail ? (
            <>
              {" "}
              {interpolate(t.checkout.questions, { email: shop.contactEmail })}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="surface-card rounded-2xl p-3.5">
      <span className="text-muted flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </span>
      <span
        className={`mt-1.5 block text-lg font-semibold tabular-nums ${
          accent ? "accent-text" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
