import type { Metadata } from "next";
import { Tags, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopCoupons } from "@/lib/queries";
import { deleteCoupon, toggleCoupon } from "@/lib/actions/coupons";
import { bpToPercent } from "@/lib/pricing";
import { PageHeader } from "@/components/admin/page-header";
import { CouponForm } from "@/components/admin/coupon-form";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { LockedFeature } from "@/components/admin/locked-feature";
import { can } from "@/lib/plans";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  const { shop } = await requireShop();
  const coupons = await getShopCoupons(shop.id);
  const now = new Date();

  if (!can(shop, "coupons")) {
    return (
      <>
        <PageHeader
          title="Coupons"
          description="Discount codes buyers enter at checkout."
        />
        <LockedFeature
          shop={shop}
          feature="coupons"
          icon={<Tags className="size-8" />}
          title="Discount codes"
          description="Run promotions with percentage or fixed discounts, minimum spend, usage caps and expiry dates."
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
        title="Coupons"
        description="Discount codes buyers enter at checkout."
      />

      <div className="mb-5">
        <CouponForm currency={shop.currency} />
      </div>

      {coupons.length === 0 ? (
        <EmptyState
          icon={<Tags className="size-8" />}
          title="No coupons yet"
          description="Create a code above and share it with your customers."
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {coupons.map((coupon) => {
            const expired = coupon.expiresAt && coupon.expiresAt <= now;
            const usedUp =
              coupon.maxRedemptions !== null &&
              coupon.timesRedeemed >= coupon.maxRedemptions;

            return (
              <div
                key={coupon.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-ink-100 px-2 py-0.5 text-sm font-semibold">
                      {coupon.code}
                    </code>
                    <span className="text-sm text-ink-700">
                      {coupon.discountType === "percent"
                        ? `${bpToPercent(coupon.discountValue)}% off`
                        : `${formatMoney(coupon.discountValue, shop.currency)} off`}
                    </span>
                    {!coupon.isActive ? (
                      <Badge tone="neutral">Inactive</Badge>
                    ) : expired ? (
                      <Badge tone="red">Expired</Badge>
                    ) : usedUp ? (
                      <Badge tone="red">Used up</Badge>
                    ) : (
                      <Badge tone="green">Live</Badge>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-ink-500">
                    {coupon.minSubtotalCents > 0
                      ? `Min ${formatMoney(coupon.minSubtotalCents, shop.currency)} · `
                      : ""}
                    Used {coupon.timesRedeemed}
                    {coupon.maxRedemptions !== null
                      ? ` of ${coupon.maxRedemptions}`
                      : " times"}
                    {coupon.expiresAt
                      ? ` · ${expired ? "Expired" : "Expires"} ${coupon.expiresAt.toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
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
                      size="sm"
                      type="submit"
                      aria-label={`Delete ${coupon.code}`}
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
  );
}
