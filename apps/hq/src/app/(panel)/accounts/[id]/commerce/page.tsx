import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card } from "@sailo/design-system/web";
import { Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Mono, SectionTitle } from "@/app/_components/hq-ui";
import { OrdersTable } from "../_components/orders-table";
import { CatalogueTable } from "../_components/catalogue-table";
import { AffiliatesTable } from "../_components/affiliates-table";
import { BuyersTable } from "../_components/buyers-table";
import { getAccountCommerce, getAccountHeader } from "@/lib/platform";
import { isPaymentMethodType, PAYMENT_METHOD_DEFS } from "@sailo/payments/offline";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Commerce" };

/**
 * What this shop sells, to whom, and how it takes the money.
 *
 * The four tables and the checkout configuration, which is the bulk of what the
 * old single-page account was. They are together because they are one question
 * asked four ways — "is this a real business?" — and apart from the rest
 * because nobody arriving to check a plan or answer a chargeback needs any of
 * them loaded.
 *
 * The lists are deliberately longer here than they were on the combined page.
 * Ten orders was a preview beside eleven other panels; on a tab that exists to
 * show the catalogue, twenty-five is the number that answers the question
 * without a second click.
 */
export default async function HqAccountCommercePage({
  params,
}: PageProps<"/accounts/[id]/commerce">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header?.shop) notFound();

  const shop = header.shop;
  const detail = await getAccountCommerce(shop.id);
  const money = (cents: number) => formatMoney(cents, shop.currency);

  return (
    <>
      <OrdersTable detail={detail} />
      <CatalogueTable detail={detail} shop={shop} />
      <AffiliatesTable detail={detail} shop={shop} />
      <BuyersTable detail={detail} shop={shop} />

      <SectionTitle>Checkout</SectionTitle>
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            Payment rails
          </h3>
          {/*
            Cards first, and separately.

            `getShopPaymentMethods` returns the seller's *offline* rails — bank
            transfer, cash, the chat-based ones. Card payments are not in that
            table at all; they are `stripeChargesEnabled` on the shop. So an
            empty list used to render "No rails configured — this shop can't
            take an order" on shops that were merrily taking Visa, which is a
            statement of fact that is simply false and the sort of thing
            somebody acts on before checking.
          */}
          <ul className="space-y-2">
            <li className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-700">Card (Stripe)</span>
              <Badge tone={shop.stripeChargesEnabled ? "green" : "neutral"}>
                {shop.stripeChargesEnabled
                  ? "On"
                  : shop.stripeAccountId
                    ? "Not yet"
                    : "Off"}
              </Badge>
            </li>
            {detail.payments.map((method) => (
              <li
                key={method.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate text-ink-700">
                  {isPaymentMethodType(method.type)
                    ? PAYMENT_METHOD_DEFS[method.type].name
                    : method.type}
                </span>
                <Badge tone={method.isEnabled ? "green" : "neutral"}>
                  {method.isEnabled ? "On" : "Off"}
                </Badge>
              </li>
            ))}
          </ul>
          {!shop.stripeChargesEnabled &&
          detail.payments.filter((m) => m.isEnabled).length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-amber-700">
              Nothing is switched on — this shop cannot take an order.
            </p>
          ) : null}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            Delivery
          </h3>
          {detail.delivery.length === 0 ? (
            <p className="text-sm text-ink-500">
              No delivery options — digital and service shops don&rsquo;t need
              any.
            </p>
          ) : (
            <ul className="space-y-2">
              {detail.delivery.map((option) => (
                <li
                  key={option.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate text-ink-700">
                    {option.name}
                    <span className="ms-1.5 text-xs text-ink-400">
                      {option.feeCents > 0 ? money(option.feeCents) : "Free"}
                    </span>
                  </span>
                  <Badge tone={option.isEnabled ? "green" : "neutral"}>
                    {option.isEnabled ? "On" : "Off"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {detail.coupons.length > 0 ? (
        <>
          <SectionTitle>Discount codes</SectionTitle>
          <Table
            minWidth="32rem"
            head={
              <>
                <Th>Code</Th>
                <Th>Discount</Th>
                <Th align="end">Redeemed</Th>
                <Th>State</Th>
              </>
            }
          >
            {detail.coupons.map((coupon) => (
              <Tr key={coupon.id}>
                <Td>
                  <Mono>{coupon.code}</Mono>
                </Td>
                <Td label="Discount">
                  {coupon.discountType === "percent"
                    ? `${coupon.discountValue / 100}%`
                    : money(coupon.discountValue)}
                </Td>
                <Td align="end" className="tabular" label="Redeemed">
                  {coupon.timesRedeemed}
                  {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions}` : ""}
                </Td>
                <Td label="State">
                  <Badge tone={coupon.isActive ? "green" : "neutral"}>
                    {coupon.isActive ? "Active" : "Off"}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}

      <SectionTitle>Storefront</SectionTitle>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-ink-400">Handle</p>
            <p className="mt-0.5 text-sm text-ink-900">
              <Mono>/{shop.handle}</Mono>
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400">Language</p>
            <p className="mt-0.5 text-sm text-ink-900">
              {shop.locale ?? "Follows the visitor"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400">Look</p>
            <p className="mt-0.5 text-sm text-ink-900">
              {shop.theme} · {shop.layout}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400">Affiliate programme</p>
            <p className="mt-0.5 text-sm text-ink-900">
              {shop.affiliatesEnabled
                ? `On · ${(shop.affiliateDefaultBp / 100).toFixed(0)}% default`
                : "Off"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400">Categories</p>
            <p className="mt-0.5 text-sm text-ink-900">{detail.categoryCount}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400">Reviews</p>
            <p className="mt-0.5 text-sm text-ink-900">{detail.reviewCount}</p>
          </div>
        </div>
      </Card>
    </>
  );
}
