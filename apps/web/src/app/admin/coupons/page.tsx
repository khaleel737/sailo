import type { Metadata } from "next";
import { Tags, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopCoupons } from "@/lib/queries";
import { deleteCoupon, toggleCoupon } from "@/lib/actions/coupons";
import { bpToPercent } from "@sailo/core/pricing";
import { PageHeader } from "@/components/shared/page-header";
import { CouponForm } from "@/app/admin/coupons/_components/coupon-form";
import { Table, Td, Th, Tr } from "@/components/shared/table";
import { Badge, Button, EmptyState } from "@/components/ui";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { can } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";
import { getT, getAdminT } from "@/i18n/server";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();
  const { t } = await getT();
  const coupons = await getShopCoupons(shop.id);
  const now = new Date();

  if (!can(shop, "coupons")) {
    return (
      <>
        <PageHeader
          title={a.coupons.title}
          description={a.coupons.description}
        />
        <LockedFeature
          t={t}
          shop={shop}
          feature="coupons"
          icon={<Tags className="size-8" />}
          title={a.coupons.discountCodes}
          description={a.coupons.discountCodesBody}
          points={[
            "WELCOME10 for 10% off a first order",
            "£5 off when they spend £30",
            "Limit a code to the first 100 uses",
          ]}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={a.coupons.title}
        description={a.coupons.description}
      />

      <div className="mb-5">
        <CouponForm currency={shop.currency} />
      </div>

      {coupons.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-6" />}
          title={a.coupons.empty}
          description={a.coupons.emptyBody}
        />
      ) : (
        <Table
          minWidth="44rem"
          head={
            <>
              <Th>{a.columns.code}</Th>
              <Th>{a.columns.status}</Th>
              <Th align="end">{a.columns.discount}</Th>
              <Th align="end">{a.columns.used}</Th>
              <Th align="end">{a.columns.expires}</Th>
              <Th className="w-28">
                <span className="sr-only">{a.columns.actions}</span>
              </Th>
            </>
          }
        >
          {coupons.map((coupon) => {
            const expired = coupon.expiresAt && coupon.expiresAt <= now;
            const usedUp =
              coupon.maxRedemptions !== null &&
              coupon.timesRedeemed >= coupon.maxRedemptions;

            return (
              <Tr key={coupon.id}>
                <Td>
                  <code className="rounded-md bg-ink-100 px-2 py-1 font-mono text-xs font-semibold text-ink-900">
                    {coupon.code}
                  </code>
                  {coupon.minSubtotalCents > 0 ? (
                    <span className="ms-2 text-xs text-ink-400">
                      min {formatMoney(coupon.minSubtotalCents, shop.currency, locale)}
                    </span>
                  ) : null}
                </Td>

                <Td label={a.columns.status}>
                  {!coupon.isActive ? (
                    <Badge tone="neutral" dot>
                      {a.common.inactive}
                    </Badge>
                  ) : expired ? (
                    <Badge tone="red" dot>
                      {a.coupons.expired}
                    </Badge>
                  ) : usedUp ? (
                    <Badge tone="red" dot>
                      {a.coupons.usedUp}
                    </Badge>
                  ) : (
                    <Badge tone="green" dot>
                      {a.common.live}
                    </Badge>
                  )}
                </Td>

                <Td align="end" className="tabular whitespace-nowrap text-ink-900" label={a.columns.discount}>
                  {coupon.discountType === "percent"
                    ? `${bpToPercent(coupon.discountValue)}% off`
                    : `${formatMoney(coupon.discountValue, shop.currency, locale)} off`}
                </Td>

                <Td align="end" className="tabular whitespace-nowrap" label={a.columns.used}>
                  {coupon.timesRedeemed}
                  {coupon.maxRedemptions !== null
                    ? ` / ${coupon.maxRedemptions}`
                    : ""}
                </Td>

                <Td align="end" className="tabular whitespace-nowrap" label={a.columns.expires}>
                  {coupon.expiresAt ? (
                    coupon.expiresAt.toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  ) : (
                    <span className="text-ink-300">{a.columns.never}</span>
                  )}
                </Td>

                <Td align="end">
                  <span className="flex items-center justify-end gap-1">
                    <form action={toggleCoupon}>
                      <input type="hidden" name="id" value={coupon.id} />
                      <Button variant="secondary" size="sm" type="submit">
                        {coupon.isActive ? "Pause" : "Activate"}
                      </Button>
                    </form>
                    <form action={deleteCoupon}>
                      <input type="hidden" name="id" value={coupon.id} />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        type="submit"
                        aria-label={`Delete ${coupon.code}`}
                        className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </span>
                </Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
