import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Detail, Mono, SectionTitle, StripeLink, When } from "@/app/_components/hq-ui";
import { getClosure } from "@/lib/platform";
import { formatMoney } from "@sailo/core/currency";

export async function generateMetadata({
  params,
}: PageProps<"/closures/[id]">): Promise<Metadata> {
  const { id } = await params;
  const detail = await getClosure(id);
  return { title: detail ? `/${detail.closure.handle}` : "Closure" };
}

/**
 * One closed shop, in as much detail as survives.
 *
 * The page somebody opens holding a support email that names a storefront which
 * no longer exists. Everything here was read out of live rows immediately
 * before they were erased — see `recordClosure` — so it is the only account of
 * this shop there will ever be, and it is written to be read cold a year later
 * by somebody who was not there.
 */
export default async function HqClosurePage({
  params,
}: PageProps<"/closures/[id]">) {
  const { id } = await params;
  const detail = await getClosure(id);
  if (!detail) notFound();

  const { closure, shop, others } = detail;
  const money = (cents: number) => formatMoney(cents, closure.currency);
  const suspicious = closure.identityRetained === "suspicion";

  return (
    <>
      <PageHeader
        back={{ href: "/closures", label: "Closures" }}
        title={closure.shopName ?? `/${closure.handle}`}
        description={
          closure.ownerEmail
            ? `${closure.ownerName ?? "Owner"} · ${closure.ownerEmail}`
            : "Identity not retained — this closure had nothing wrong with it."
        }
        meta={
          <>
            <Badge tone={suspicious ? "amber" : "neutral"} dot>
              {suspicious ? "Closed under suspicion" : "Clean closure"}
            </Badge>
            <Badge tone="neutral">
              {closure.closedBy === "staff" ? "Closed by us" : "Closed by the seller"}
            </Badge>
          </>
        }
      />

      {closure.undeliveredPaidOrders > 0 ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-900">
          <p className="font-medium">
            {closure.undeliveredPaidOrders} paid order
            {closure.undeliveredPaidOrders === 1 ? "" : "s"} had not been
            delivered when this shop closed.
          </p>
          <p className="mt-0.5 opacity-90">
            Buyers paid for these and received nothing. The orders themselves
            survive on the tombstoned shop — they are the ledger, and they are
            what a refund or a chargeback would be worked from.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            {/*
              A plain heading, not `SectionTitle`.

              `SectionTitle` carries `mt-8` so page-level sections breathe
              apart from each other. Inside a Card — which already has its own
              padding — that margin is just dead space pushing the heading away
              from the top of its own box.
            */}
            <h2 className="mb-4 text-sm font-semibold text-ink-900">What it turned over</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Detail label="Gross">{money(closure.grossCents)}</Detail>
              <Detail label="Refunded">{money(closure.refundedCents)}</Detail>
              <Detail label="Net">
                {money(closure.grossCents - closure.refundedCents)}
              </Detail>
              <Detail label="Orders">
                {closure.orderCount.toLocaleString()} · {closure.paidOrderCount} paid
              </Detail>
              <Detail label="Buyers">{closure.buyerCount.toLocaleString()}</Detail>
              <Detail label="Products">{closure.productCount.toLocaleString()}</Detail>
              <Detail label="First order">
                <When value={closure.firstOrderAt} />
              </Detail>
              <Detail label="Last order">
                <When value={closure.lastOrderAt} />
              </Detail>
              <Detail label="Shop opened">
                <When value={closure.shopCreatedAt} />
              </Detail>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink-900">Chargebacks</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Detail label="Total">{closure.disputeCount.toLocaleString()}</Detail>
              <Detail label="Open at closure">
                {money(closure.openDisputeCents)}
              </Detail>
              <Detail label="Undelivered and paid">
                {closure.undeliveredPaidOrders.toLocaleString()}
              </Detail>
            </div>
          </Card>

          {/*
            The catalogue, capped at fifty. This is the half of the record that
            reads as evidence rather than as accounting: "forty listings all
            named after the same designer handbag" is the entire finding, and it
            is the only place it survives — `products` is hard-deleted.
          */}
          <div>
            <SectionTitle>
              What it said it sold — {closure.catalogue.length}
              {closure.catalogue.length === 50 ? " (first 50)" : ""}
            </SectionTitle>
            <Table
              minWidth="30rem"
              head={
                <>
                  <Th>Title</Th>
                  <Th>Kind</Th>
                  <Th align="end">Price</Th>
                </>
              }
            >
              {closure.catalogue.length === 0 ? (
                <EmptyRow colSpan={3}>
                  Nothing was listed when this shop closed.
                </EmptyRow>
              ) : (
                closure.catalogue.map((item, index) => (
                  <Tr key={`${item.title}-${index}`}>
                    <Td>{item.title}</Td>
                    <Td label="Kind" className="text-ink-500">
                      {item.kind}
                    </Td>
                    <Td align="end" className="tabular" label="Price">
                      {money(item.priceCents)}
                    </Td>
                  </Tr>
                ))
              )}
            </Table>
          </div>

          {others.length > 0 ? (
            <div>
              {/*
                The same owner's other closures, matched on the keyed digest
                rather than on an address — so this works even where neither
                closure retained a readable identity. One closure is somebody
                moving on; three is a pattern, and this is the only screen on
                which that pattern is visible at all.
              */}
              <SectionTitle>This owner has closed other shops</SectionTitle>
              <Card className="divide-y divide-ink-100">
                {others.map((other) => (
                  <Link
                    key={other.id}
                    href={`/closures/${other.id}`}
                    className="focus-ring flex flex-wrap items-center justify-between gap-2 p-4 text-sm transition hover:bg-ink-50"
                  >
                    <span className="min-w-0">
                      <Mono>/{other.handle}</Mono>
                      <span className="ms-2 text-ink-500">
                        closed <When value={other.closedAt} />
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {other.undeliveredPaidOrders > 0 ? (
                        <Badge tone="red">
                          {other.undeliveredPaidOrders} undelivered
                        </Badge>
                      ) : null}
                      {other.disputeCount > 0 ? (
                        <Badge tone="amber">
                          {other.disputeCount} chargeback
                          {other.disputeCount === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                      {other.identityRetained === "suspicion" ? (
                        <Badge tone="amber">Under suspicion</Badge>
                      ) : null}
                    </span>
                  </Link>
                ))}
              </Card>
            </div>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-3">
          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              The closure
            </h3>
            <div className="space-y-3">
              <Detail label="Closed">
                <When value={closure.closedAt} withTime />
              </Detail>
              <Detail label="By">
                {closure.closedByEmail ?? (closure.closedBy === "staff" ? "Staff" : "The seller")}
              </Detail>
              {closure.reason ? (
                <Detail label="Reason">{closure.reason}</Detail>
              ) : null}
              <Detail label="Traded as">
                <Mono>/{closure.handle}</Mono>
              </Detail>
              <Detail label="Currency">{closure.currency}</Detail>
              {closure.location ? (
                <Detail label="Location">{closure.location}</Detail>
              ) : null}
              {closure.contactEmail ? (
                <Detail label="Contact">{closure.contactEmail}</Detail>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              What we thought at the time
            </h3>
            <div className="space-y-3">
              <Detail label="Suspended">
                <When value={closure.suspendedAt} />
              </Detail>
              {closure.suspendedReason ? (
                <Detail label="Suspension reason">{closure.suspendedReason}</Detail>
              ) : null}
              <Detail label="Payouts held">
                <When value={closure.payoutsPausedAt} />
              </Detail>
              <Detail label="Internal note">
                {closure.staffNote ?? "—"}
              </Detail>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Where the trail continues
            </h3>
            <div className="space-y-3">
              <Detail label="Connected account">
                <StripeLink id={closure.stripeAccountId} kind="connect/accounts" />
              </Detail>
              <Detail label="Billing customer">
                <StripeLink id={closure.stripeCustomerId} kind="customers" />
              </Detail>
              <Detail label="Shop id">
                <Mono>{closure.shopId}</Mono>
              </Detail>
              {shop ? (
                <Detail label="Tombstone">
                  {/*
                    The surviving `shops` row, which is where the orders and
                    invoices still hang. Linked through the owner because that
                    is the route the accounts page takes, and it is the only way
                    to reach the ledger this shop left behind.
                  */}
                  <Link
                    href={`/accounts/${shop.userId}`}
                    className="text-ink-900 underline decoration-ink-300 underline-offset-2 hover:text-brand-700"
                  >
                    The surviving account
                  </Link>
                </Detail>
              ) : null}
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
              Identity
            </h3>
            <p className="text-xs leading-relaxed text-ink-500">
              {suspicious
                ? "Kept, because this shop was suspended, had payouts held, had a live chargeback, left buyers undelivered, or was closed by us. That is a specific legitimate interest in a specific dispute, not a policy of keeping everybody's name."
                : "Not kept. This closure had nothing wrong with it, so the owner's name and address were erased with the account. The keyed digest below still recognises them if they sign up again — it cannot be read, mailed or exported."}
            </p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-400 break-all">
              {closure.ownerEmailHash
                ? `${closure.ownerEmailHash.slice(0, 16)}…`
                : "No digest — the address was already a tombstone when this was written."}
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
