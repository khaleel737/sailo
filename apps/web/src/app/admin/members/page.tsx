import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { BadgeCheck } from "lucide-react";
import { getDb } from "@sailo/db";
import { clients, products } from "@sailo/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { shopSubscriptions } from "@/lib/membership-access";
import { membershipAccess } from "@sailo/commerce/memberships";
import { visitSummary } from "@sailo/commerce/memberships/server";
import { PageHeader } from "@sailo/design-system/web";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { Card, EmptyState, Stat } from "@sailo/design-system/web";
import { formatMoney } from "@sailo/core/currency";
import { MemberRow } from "./_components/member-row";

export const metadata: Metadata = { title: "Members" };

/**
 * Everyone paying the shop on a recurring basis.
 *
 * Cancelled members stay in the list rather than disappearing, and that is the
 * point of the screen: "who left last month" is the question that makes a
 * seller do something, and a list that only shows active members answers it
 * by omission — which is to say, never.
 */
export default async function MembersPage() {
  const { shop } = await requireShop("orders:read");
  const { a, locale } = await getAdminT();
  const { t } = await getT();

  if (!can(shop, "memberships")) {
    return (
      <LockedFeature
        shop={shop}
        feature="memberships"
        icon={<BadgeCheck className="size-6" />}
        title={a.members.title}
        description={a.members.lockedBody}
        t={t}
      />
    );
  }

  const rows = await shopSubscriptions(shop.id);

  /*
   * The names, in two queries rather than two per row. A shop with three
   * hundred members would otherwise make six hundred round trips to render
   * one page.
   */
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((id): id is string => Boolean(id)))];
  const productIds = [...new Set(rows.map((r) => r.productId).filter((id): id is string => Boolean(id)))];

  const [people, plans, visits] = await Promise.all([
    clientIds.length
      ? getDb().query.clients.findMany({ where: inArray(clients.id, clientIds) })
      : Promise.resolve([]),
    productIds.length
      ? getDb().query.products.findMany({ where: inArray(products.id, productIds) })
      : Promise.resolve([]),
    /*
     * Attendance for every member at once. Grouped in Postgres and handed back
     * as a Map for the same reason the two lookups above are bulk: a gym with
     * three hundred members would otherwise be three hundred more round trips
     * to draw one list.
     */
    visitSummary(shop.id),
  ]);

  const byClient = new Map(people.map((p) => [p.id, p]));
  const byProduct = new Map(plans.map((p) => [p.id, p]));

  const now = new Date();
  const live = rows.filter((row) => membershipAccess(row, now).open);

  /*
   * What the active memberships bill in a month, at today's prices.
   *
   * A yearly membership contributes a twelfth, because the number a seller
   * wants is "what does this bring in monthly" and counting a year's payment
   * in the month it lands makes that number jump twelve-fold and then vanish.
   * Approximate on purpose, and labelled as such — the exact figure is
   * Stripe's, and it depends on renewals nobody has made yet.
   */
  const monthlyCents = live.reduce(
    (sum, row) => sum + (row.interval === "year" ? Math.round(row.priceCents / 12) : row.priceCents),
    0,
  );

  return (
    <>
      <PageHeader title={a.members.title} description={a.members.description} />

      {rows.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="size-6" />}
          title={a.members.empty}
          description={a.members.emptyBody}
        />
      ) : (
        <>
          {/* `Stat` draws its own card, so these are not wrapped in one. */}
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <Stat
              label={a.members.activeMembers}
              value={live.length.toLocaleString(locale)}
            />
            <Stat
              label={a.members.monthlyRevenue}
              value={formatMoney(monthlyCents, shop.currency, locale)}
              hint={a.members.revenueHint}
            />
          </div>

          <Card className="divide-y divide-ink-100">
            {rows.map((row) => (
              <MemberRow
                key={row.id}
                subscription={row}
                name={row.clientId ? (byClient.get(row.clientId)?.name ?? null) : null}
                email={row.clientId ? (byClient.get(row.clientId)?.email ?? null) : null}
                productTitle={
                  row.productId ? (byProduct.get(row.productId)?.title ?? null) : null
                }
                locale={locale}
                visits={visits.get(row.id) ?? null}
              />
            ))}
          </Card>
        </>
      )}
    </>
  );
}
