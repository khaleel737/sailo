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
import { PageHeader } from "@/components/admin/page-header";
import {
  AffiliateForm,
  AffiliateLink,
  AffiliateSettingsForm,
} from "@/components/admin/affiliate-widgets";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Affiliates" };

const SOURCE_LABEL: Record<string, string> = {
  manual: "Added by you",
  signup: "Applied",
  buyer: "Past buyer",
};

export default async function AdminAffiliatesPage() {
  const { shop } = await requireShop();
  const affiliates = await getShopAffiliates(shop.id);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const pending = affiliates.filter((a) => a.status === "pending");
  const totalUnpaid = affiliates.reduce((sum, a) => sum + a.unpaidCents, 0);

  return (
    <>
      <PageHeader
        title="Affiliates"
        description="Pay people a share of what they sell for you."
      />

      <div className="mb-5">
        <AffiliateSettingsForm shop={shop} />
      </div>

      {!shop.affiliatesEnabled ? (
        <p className="text-sm text-ink-500">
          Turn the programme on above to add affiliates and share links.
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
              title="No affiliates yet"
              description="Add someone above, or let buyers opt in after they order."
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
                            <Badge tone="green">Active</Badge>
                          ) : affiliate.status === "pending" ? (
                            <Badge tone="amber">Pending</Badge>
                          ) : (
                            <Badge>Disabled</Badge>
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

                        <div className="mt-2 max-w-md">
                          <AffiliateLink
                            url={`${base}/${shop.handle}?ref=${affiliate.code}`}
                          />
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
                        <p className="text-xs text-ink-500">earned</p>
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
                            Disable
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
                            Mark paid
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
