import type { Metadata } from "next";
import { Gift, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopAffiliates } from "@/lib/queries";
import {
  deleteAffiliate,
  markCommissionsPaid,
  setAffiliateStatus,
} from "@/lib/actions/affiliates";
import { bpToPercent } from "@sailo/core/pricing";
import { PageHeader } from "@sailo/design-system/web";
import {
  AffiliateForm,
  AffiliateLink,
  AffiliateSettingsForm,
} from "@/app/admin/affiliates/_components/affiliate-widgets";
import { Badge, Button, Card, EmptyState } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { can } from "@sailo/core/plans";
import { formatMoney } from "@sailo/core/currency";
import { CopyLink } from "@sailo/design-system/web";
import { ensurePortalToken, portalUrl } from "@sailo/partners/portal";
import { getT, getAdminT } from "@/i18n/server";
import { appOrigin } from "@sailo/core/origin";
import {
  AFFILIATE_STATUS_TONES,
  type AffiliateStatus,
} from "@sailo/commerce/shop-views";

export const metadata: Metadata = { title: "Affiliates" };

/*
 * KNOWN GAP: hardcoded English on a page that otherwise speaks 34 languages.
 * Fixing it means three keys through the i18n batch tooling; the tones are
 * already shared with /hq via AFFILIATE_STATUS_TONES, and the *wording*
 * deliberately differs per audience (staff read the feature name).
 */
const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by you",
  signup: "Applied",
  buyer: "Past buyer",
};

export default async function AdminAffiliatesPage() {
  const { shop } = await requireShop("marketing:read");
  const { a, locale } = await getAdminT();
  const { t } = await getT();

  if (!can(shop, "affiliates")) {
    return (
      <>
        <PageHeader
          title={a.affiliates.title}
          description={a.affiliates.description}
        />
        <LockedFeature
          t={t}
          shop={shop}
          feature="affiliates"
          icon={<Gift className="size-8" />}
          title={a.affiliates.programme}
          description={a.affiliates.programmeBody}
          points={[
            "Set a default rate, or a different one per affiliate",
            "Track clicks, orders and commission owed",
            "A public sign-up page for your shop",
          ]}
        />
      </>
    );
  }

  const affiliates = await getShopAffiliates(shop.id);

  const payoutNames: Record<string, string> = {
    bank: a.affiliates.payoutBank,
    paypal: a.affiliates.payoutPaypal,
    other: a.affiliates.payoutOther,
  };

  const base = appOrigin();

  // One token per affiliate, minted the first time the seller looks.
  const portalUrls = new Map<string, string>();
  for (const affiliate of affiliates) {
    portalUrls.set(affiliate.id, portalUrl(await ensurePortalToken(affiliate), base));
  }
  const pending = affiliates.filter((affiliate) => affiliate.status === "pending");
  const totalUnpaid = affiliates.reduce((sum, affiliate) => sum + affiliate.unpaidCents, 0);

  return (
    <>
      <PageHeader
        title={a.affiliates.title}
        description={a.affiliates.description}
      />

      <div className="mb-5">
        <AffiliateSettingsForm shop={shop} />
      </div>

      {!shop.affiliatesEnabled ? (
        <p className="text-sm text-ink-500">
          {a.affiliates.turnOnFirst}
        </p>
      ) : (
        <>
          {totalUnpaid > 0 ? (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm text-amber-900">
                <span className="font-medium">
                  {formatMoney(totalUnpaid, shop.currency, locale)}
                </span>{" "}
                in commission is owed across{" "}
                {affiliates.filter((affiliate) => affiliate.unpaidCents > 0).length} affiliate
                {affiliates.filter((affiliate) => affiliate.unpaidCents > 0).length === 1
                  ? ""
                  : "s"}
                .
              </p>
            </div>
          ) : null}

          {pending.length > 0 ? (
            <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-900">
                {pending.length} application
                {pending.length === 1 ? "" : "s"} waiting for approval.
              </p>
            </div>
          ) : null}

          <div className="mb-5">
            <AffiliateForm defaultBp={shop.affiliateDefaultBp} />
          </div>

          {affiliates.length === 0 ? (
            <EmptyState
              icon={<Gift className="size-8" />}
              title={a.affiliates.empty}
              description={a.affiliates.emptyBody}
            />
          ) : (
            <Card className="divide-y divide-ink-100">
              {affiliates.map((affiliate) => {
                const rate = affiliate.commissionBp ?? shop.affiliateDefaultBp;
                return (
                  <div key={affiliate.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">
                            {affiliate.name}
                          </span>
                          <code className="rounded-md bg-ink-100 px-1.5 py-0.5 text-xs font-semibold">
                            {affiliate.code}
                          </code>
                          <Badge tone="blue">{bpToPercent(rate)}%</Badge>
                          <Badge
                            tone={
                              AFFILIATE_STATUS_TONES[
                                affiliate.status as AffiliateStatus
                              ] ?? "neutral"
                            }
                          >
                            {affiliate.status === "active"
                              ? a.common.active
                              : affiliate.status === "pending"
                                ? a.common.pending
                                : a.common.disabled}
                          </Badge>
                          <Badge>
                            {SOURCE_LABEL[affiliate.source] ?? affiliate.source}
                          </Badge>
                        </div>

                        {affiliate.email ? (
                          <p className="mt-1 text-xs text-ink-500">
                            {affiliate.email}
                          </p>
                        ) : null}

                        {/* Their answer to "where do I send it" — entered on
                            their portal, shown in full only here, to the one
                            person who has to act on it. */}
                        {affiliate.payoutMethod && affiliate.payoutDetails ? (
                          <p className="mt-1 text-xs text-ink-500">
                            {a.affiliates.payoutLabel}:{" "}
                            <span className="font-medium text-ink-700">
                              {payoutNames[affiliate.payoutMethod] ??
                                affiliate.payoutMethod}{" "}
                              · {affiliate.payoutDetails}
                            </span>
                            {affiliate.payoutUpdatedAt
                              ? ` · ${affiliate.payoutUpdatedAt.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`
                              : ""}
                          </p>
                        ) : null}

                        <div className="mt-2 max-w-md space-y-1.5">
                          <AffiliateLink
                            url={`${base}/${shop.handle}?ref=${affiliate.code}`}
                          />
                          {/* Their own report — the seller sends this once and
                              never has to answer "how much have I earned?" */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-ink-400">
                              {a.affiliates.reportLink}
                            </span>
                            <CopyLink
                              url={portalUrls.get(affiliate.id) ?? ""}
                              variant="onDark"
                              copyLabel={a.affiliates.copyReport}
                            />
                          </div>
                        </div>

                        <p className="mt-2 text-xs text-ink-500">
                          {affiliate.clicks} click
                          {affiliate.clicks === 1 ? "" : "s"} ·{" "}
                          {affiliate.orderCount} order
                          {affiliate.orderCount === 1 ? "" : "s"} ·{" "}
                          {formatMoney(affiliate.salesCents, shop.currency, locale)} sold
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatMoney(affiliate.earnedCents, shop.currency, locale)}
                        </p>
                        <p className="text-xs text-ink-500">{a.affiliates.earned}</p>
                        {affiliate.unpaidCents > 0 ? (
                          <p className="mt-0.5 text-xs font-medium text-amber-600">
                            {formatMoney(affiliate.unpaidCents, shop.currency, locale)}{" "}
                            owed
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {affiliate.status !== "active" ? (
                        <form action={setAffiliateStatus}>
                          <input type="hidden" name="id" value={affiliate.id} />
                          <input type="hidden" name="status" value="active" />
                          <Button variant="secondary" size="sm" type="submit">
                            {affiliate.status === "pending"
                              ? "Approve"
                              : "Enable"}
                          </Button>
                        </form>
                      ) : (
                        <form action={setAffiliateStatus}>
                          <input type="hidden" name="id" value={affiliate.id} />
                          <input type="hidden" name="status" value="disabled" />
                          <Button variant="secondary" size="sm" type="submit">
                            {a.common.disable}
                          </Button>
                        </form>
                      )}

                      {affiliate.unpaidCents > 0 ? (
                        <form action={markCommissionsPaid}>
                          <input
                            type="hidden"
                            name="affiliateId"
                            value={affiliate.id}
                          />
                          <Button variant="secondary" size="sm" type="submit">
                            {a.affiliates.markPaid}
                          </Button>
                        </form>
                      ) : null}

                      <form action={deleteAffiliate}>
                        <input type="hidden" name="id" value={affiliate.id} />
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                          aria-label={`Delete ${affiliate.name}`}
                          className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </>
  );
}
