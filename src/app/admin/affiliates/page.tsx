import type { Metadata } from "next";
import { Gift, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopAffiliates } from "@/lib/queries";
import {
  deleteAffiliate,
  markCommissionsPaid,
  setAffiliateStatus,
} from "@/lib/actions/affiliates";
import { bpToPercent } from "@/lib/pricing";
import { PageHeader } from "@/components/shared/page-header";
import {
  AffiliateForm,
  AffiliateLink,
  AffiliateSettingsForm,
} from "@/app/admin/affiliates/_components/affiliate-widgets";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { can } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";
import { CopyLink } from "@/components/shared/copy-link";
import { ensurePortalToken, portalUrl } from "@/lib/affiliate-portal";
import { getT, getAdminT } from "@/i18n/server";

export const metadata: Metadata = { title: "Affiliates" };

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by you",
  signup: "Applied",
  buyer: "Past buyer",
};

export default async function AdminAffiliatesPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();
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

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // One token per affiliate, minted the first time the seller looks.
  const portalUrls = new Map<string, string>();
  for (const affiliate of affiliates) {
    portalUrls.set(affiliate.id, portalUrl(await ensurePortalToken(affiliate), base));
  }
  const pending = affiliates.filter((a) => a.status === "pending");
  const totalUnpaid = affiliates.reduce((sum, a) => sum + a.unpaidCents, 0);

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
                  {formatMoney(totalUnpaid, shop.currency)}
                </span>{" "}
                in commission is owed across{" "}
                {affiliates.filter((a) => a.unpaidCents > 0).length} affiliate
                {affiliates.filter((a) => a.unpaidCents > 0).length === 1
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
                          {affiliate.status === "active" ? (
                            <Badge tone="green">{a.common.active}</Badge>
                          ) : affiliate.status === "pending" ? (
                            <Badge tone="amber">{a.common.pending}</Badge>
                          ) : (
                            <Badge>{a.common.disabled}</Badge>
                          )}
                          <Badge>
                            {SOURCE_LABEL[affiliate.source] ?? affiliate.source}
                          </Badge>
                        </div>

                        {affiliate.email ? (
                          <p className="mt-1 text-xs text-ink-500">
                            {affiliate.email}
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
                          {formatMoney(affiliate.salesCents, shop.currency)} sold
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {formatMoney(affiliate.earnedCents, shop.currency)}
                        </p>
                        <p className="text-xs text-ink-500">{a.affiliates.earned}</p>
                        {affiliate.unpaidCents > 0 ? (
                          <p className="mt-0.5 text-xs font-medium text-amber-600">
                            {formatMoney(affiliate.unpaidCents, shop.currency)}{" "}
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
