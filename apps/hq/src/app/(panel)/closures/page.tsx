import type { Metadata } from "next";
import Link from "next/link";
import { Archive, HandCoins, Gavel, ShieldAlert } from "lucide-react";
import { Badge, PageHeader } from "@sailo/design-system/web";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Metric, MetricRow, When } from "@/app/_components/hq-ui";
import { CLOSURE_SORT_OPTIONS, first, getClosures, pageNumber } from "@/lib/platform";
import { formatMoney } from "@sailo/core/currency";

export const metadata: Metadata = { title: "Closures" };

const LENS_OPTIONS = [
  { value: "all", label: "Every closure" },
  { value: "suspicion", label: "Closed under suspicion" },
  { value: "undelivered", label: "Left buyers undelivered" },
  { value: "disputed", label: "Had chargebacks" },
  { value: "staff", label: "We closed it" },
];

/**
 * Shops that ended, and what they were on the way out.
 *
 * ─── THE HOLE THIS SCREEN CLOSES ─────────────────────────────────────────────
 * Account deletion does exactly what it promises: the `shops` row survives to
 * hold the orders and invoices, and everything identifying is overwritten. The
 * name becomes "Deleted shop", the handle becomes `deleted-3f2a…`, the owner
 * becomes an address at `@sailo.invalid`, and the catalogue, the reviews and
 * the support tickets are gone.
 *
 * Which is correct for the seller who is leaving, and a blindfold for the one
 * who is not. Take deposits for a fortnight, never ship, delete the account:
 * the orders survive and nothing on them says who ran the shop or what it
 * claimed to sell. Support then gets forty emails naming a storefront that no
 * longer exists anywhere, and the honest answer to "what happened here" is that
 * we erased it ourselves, on request, at the moment it became interesting.
 *
 * `shop_closures` is one row written *before* the tombstone, and this is where
 * it is read. It is why "/accounts?shopState=deleted" is not the same screen:
 * that lists tombstones, every row an identical uuid, and there is nothing to
 * sort or search. This lists what each shop *was*.
 *
 * ─── WHY MOST ROWS HAVE NO NAME ON THEM ──────────────────────────────────────
 * By design, and it is the thing to understand before using this screen. A
 * closure keeps the *shape* of the business always — volume, buyers,
 * chargebacks, catalogue titles, a keyed digest of the owner's address — and
 * keeps the readable identity only where the closure happened under suspicion:
 * suspended, payouts held, a live chargeback, buyers undelivered, or we closed
 * it. See `packages/db/src/schema/closures.ts` for the full argument and the
 * GDPR articles it rests on.
 *
 * So "—" in the Owner column is not missing data. It is a closure that had
 * nothing wrong with it, and the digest still recognises that person if they
 * come back.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function HqClosuresPage({
  searchParams,
}: PageProps<"/closures">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    lens: first(params.lens),
    sort: first(params.sort),
    page: pageNumber(params.page),
  };

  const { rows, total, page, pages, summary } = await getClosures(filters);

  return (
    <>
      <PageHeader
        title="Closures"
        description="Every shop that ended, and what it was on the way out. Written before the account was erased, because afterwards there is nothing left to ask."
      />

      <MetricRow>
        <Metric
          icon={<Archive className="size-4" />}
          label="Shops closed"
          value={summary.total.toLocaleString()}
          hint={`${summary.lastThirty} in the last 30 days`}
        />
        <Metric
          icon={<ShieldAlert className="size-4" />}
          label="Under suspicion"
          value={summary.suspicion.toLocaleString()}
          hint="Identity retained — see the note below"
          href={summary.suspicion > 0 ? "/closures?lens=suspicion" : undefined}
        />
        <Metric
          icon={<HandCoins className="size-4" />}
          label="Orders left undelivered"
          value={summary.undelivered.toLocaleString()}
          hint="Buyers who paid and got nothing"
          href={summary.undelivered > 0 ? "/closures?lens=undelivered" : undefined}
        />
        <Metric
          icon={<Gavel className="size-4" />}
          label="Closed with chargebacks"
          value={summary.withDisputes.toLocaleString()}
          href={summary.withDisputes > 0 ? "/closures?lens=disputed" : undefined}
        />
      </MetricRow>

      <div className="mt-6">
        <HqFilters
          values={{ q: filters.q, lens: filters.lens, sort: filters.sort }}
          placeholder="Search the handle it traded under…"
          fields={[
            { name: "lens", label: "Lens", options: LENS_OPTIONS },
            {
              name: "sort",
              label: "Sort",
              options: CLOSURE_SORT_OPTIONS.map((o) => ({ ...o })),
            },
          ]}
        />
      </div>

      <Table
        minWidth="58rem"
        head={
          <>
            <Th>Shop</Th>
            <Th>Owner</Th>
            <Th>Closed</Th>
            <Th align="end">Volume</Th>
            <Th align="end">Undelivered</Th>
            <Th align="end">Chargebacks</Th>
            <Th>Standing</Th>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>
            {filters.q || filters.lens
              ? "No closures match those filters."
              : "No shop has been closed yet."}
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td>
                <Link
                  href={`/closures/${row.id}`}
                  className="focus-ring flex min-w-0 flex-col items-start justify-center rounded pointer-coarse:min-h-11"
                >
                  <span className="max-w-full truncate font-medium text-ink-900">
                    {/*
                      The retained name where there is one, and the handle
                      otherwise. The handle is on every closure and is the
                      string a support email will be quoting, so it is never a
                      dead end.
                    */}
                    {row.shopName ?? `/${row.handle}`}
                  </span>
                  {row.shopName ? (
                    <span className="max-w-full truncate text-xs text-ink-400">
                      /{row.handle}
                    </span>
                  ) : null}
                </Link>
              </Td>

              <Td label="Owner">
                {row.ownerEmail ? (
                  <span className="truncate text-ink-700">{row.ownerEmail}</span>
                ) : (
                  <span
                    className="text-ink-400"
                    title="Kept as a keyed digest only — this closure had nothing wrong with it"
                  >
                    —
                  </span>
                )}
              </Td>

              <Td label="Closed">
                <When value={row.closedAt} />
                <span className="block text-xs text-ink-400">
                  {row.closedBy === "staff" ? "by us" : "by the seller"}
                </span>
              </Td>

              <Td align="end" className="tabular whitespace-nowrap" label="Volume">
                {formatMoney(row.grossCents - row.refundedCents, row.currency)}
              </Td>

              <Td align="end" className="tabular" label="Undelivered">
                {row.undeliveredPaidOrders > 0 ? (
                  <Badge tone="red">{row.undeliveredPaidOrders}</Badge>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </Td>

              <Td align="end" className="tabular" label="Chargebacks">
                {row.disputeCount > 0 ? (
                  <Badge tone="amber">{row.disputeCount}</Badge>
                ) : (
                  <span className="text-ink-400">—</span>
                )}
              </Td>

              <Td label="Standing">
                {row.suspendedAt ? (
                  <Badge tone="red">Was suspended</Badge>
                ) : row.payoutsPausedAt ? (
                  <Badge tone="amber">Payouts were held</Badge>
                ) : row.identityRetained === "suspicion" ? (
                  <Badge tone="amber">Under suspicion</Badge>
                ) : (
                  <span className="text-xs text-ink-400">Clean</span>
                )}
              </Td>
            </Tr>
          ))
        )}
      </Table>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun="closures"
        basePath="/closures"
        params={{ q: filters.q, lens: filters.lens, sort: filters.sort }}
      />

      <p className="mt-6 max-w-prose text-xs leading-relaxed text-ink-400">
        An empty Owner column is not missing data. Every closure keeps the shape
        of the business and a keyed digest of the owner&rsquo;s address; the
        readable identity is kept only where the shop was suspended, its payouts
        held, a chargeback was live, buyers were left undelivered, or we closed
        it ourselves. The digest still recognises somebody signing up again
        either way — it simply cannot be read, mailed or exported.
      </p>
    </>
  );
}
