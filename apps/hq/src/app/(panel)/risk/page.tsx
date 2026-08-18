import type { Metadata } from "next";
import Link from "next/link";
import { AlertOctagon, Eye, Radar, ShieldAlert } from "lucide-react";
import { Badge, Card, PageHeader } from "@sailo/design-system/web";
import { Metric, MetricRow, SectionTitle, When } from "@/app/_components/hq-ui";
import { first, getRiskDesk, getReturningSellers } from "@/lib/platform";
import { staffCan } from "@/lib/session";
import type { RiskSeverity } from "@sailo/core/risk";

export const metadata: Metadata = { title: "Risk" };

const SEVERITY_TONE: Record<RiskSeverity, "red" | "amber" | "neutral"> = {
  act: "red",
  review: "amber",
  watch: "neutral",
};

const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  act: "Act",
  review: "Review",
  watch: "Watch",
};

/**
 * What the desk shows when nobody has chosen.
 *
 * `needs-work` and not `all`. The desk is a queue, and a queue's landing state
 * should be the work rather than the inventory — `watch` findings are on the
 * screen so somebody *can* look at them, not so that they are the first thing
 * anybody sees. Before this the default was everything, and on real data the
 * two findings that needed a person sat under fifty that did not.
 */
const DEFAULT_SEVERITY = "needs-work";

const SEVERITY_OPTIONS = [
  { value: "needs-work", label: "Needs work" },
  { value: "act", label: "Act" },
  { value: "review", label: "Review" },
  { value: "watch", label: "Watch" },
  { value: "all", label: "Everything" },
];

/**
 * The desk: which shops need reading this morning, and why.
 *
 * ─── WHAT THIS SCREEN IS FOR, AND WHAT IT DELIBERATELY IS NOT ────────────────
 * It is a queue, not a dashboard. There are no totals of the platform's health
 * here — /revenue and / already answer that — because a number that goes up and
 * down is not something anybody can act on, and mixing one into a queue is how
 * the queue stops being read.
 *
 * Every row is a shop with at least one finding, and every finding is a
 * sentence rather than a score. That is the whole design: somebody arriving
 * cold has to be able to read a row and know what to do next without opening
 * anything, and "risk: 74" does not do that while "9 paid orders worth 1,200
 * USD have not been delivered, on a shop that is 6 days old" does.
 *
 * ─── AND WHAT IT COSTS ───────────────────────────────────────────────────────
 * Not a scan of every shop. `getRiskDesk` builds a candidate set out of five
 * small indexed reads — shops that appear in `disputes`, in undelivered paid
 * orders, in a busy week, in an open flag, or under a standing staff decision —
 * and scores only those. The cost tracks how much is wrong with the platform
 * rather than how large it is, which is the only way round for a page that has
 * to stay usable on the worst day it is ever opened. `scanned` is printed at
 * the bottom so that stops being an invisible claim.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function HqRiskPage({ searchParams }: PageProps<"/risk">) {
  const params = await searchParams;
  const severity = first(params.severity) ?? DEFAULT_SEVERITY;

  const [desk, returning, mayAct] = await Promise.all([
    getRiskDesk({ severity }),
    getReturningSellers(10),
    staffCan("account:suspend"),
  ]);

  return (
    <>
      <PageHeader
        title="Risk"
        description="Shops with something wrong with them, loudest first. Every line is a finding a person can read — the desk never scores a shop, it says what it saw."
      />

      <MetricRow>
        <Metric
          icon={<AlertOctagon className="size-4" />}
          label="Act"
          value={desk.counts.act.toLocaleString()}
          hint="Money at stake, or a network threshold crossed"
          href={desk.counts.act > 0 ? "/risk?severity=act" : undefined}
        />
        <Metric
          icon={<ShieldAlert className="size-4" />}
          label="Review"
          value={desk.counts.review.toLocaleString()}
          hint="Somebody should read these today"
          href={desk.counts.review > 0 ? "/risk?severity=review" : undefined}
        />
        <Metric
          icon={<Eye className="size-4" />}
          label="Watch"
          value={desk.counts.watch.toLocaleString()}
          hint="On the screen, not yet a job"
        />
        <Metric
          icon={<Radar className="size-4" />}
          label="Shops measured"
          value={desk.scanned.toLocaleString()}
          hint="Candidates, not the whole platform"
        />
      </MetricRow>

      {/*
        A row of links, not `HqFilters`.
        
        `HqFilters` always renders a search box, and there is nothing on this
        screen to search: the desk is at most fifty rows and finding a specific
        shop is what /accounts is for. It shipped with the placeholder "Search
        is on the accounts page", which is an input that tells you not to use
        it — a dead control, and the kind of thing that teaches people the panel
        is approximate.
      */}
      <nav aria-label="Filter by level" className="mb-4 mt-6 flex flex-wrap gap-1.5">
        {SEVERITY_OPTIONS.map((option) => {
          const active = severity === option.value;
          return (
            <Link
              key={option.value}
              href={`/risk?severity=${option.value}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "focus-ring rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white"
                  : "focus-ring rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:border-ink-300 hover:text-ink-900"
              }
            >
              {option.label}
              {/*
                A count on every chip that has one. The "needs work" total is
                act + review by definition — it is the queue, not a severity —
                and "Everything" has no count because it is the escape hatch
                rather than a number anybody works down.
              */}
              {option.value === "needs-work" ? (
                <span className="tabular ms-1.5 text-xs opacity-60">
                  {desk.counts.act + desk.counts.review}
                </span>
              ) : option.value !== "all" ? (
                <span className="tabular ms-1.5 text-xs opacity-60">
                  {desk.counts[option.value as RiskSeverity]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {desk.rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-ink-900">Nothing on the desk.</p>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-500">
            No shop on the platform is currently tripping a finding. That is the
            expected state, and it is worth being suspicious of only if it lasts
            through a week where chargebacks went up.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {desk.rows.map((row) => (
            <li key={row.shopId}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/accounts/${row.ownerId}`}
                        className="focus-ring truncate rounded font-medium text-ink-900 hover:text-brand-700"
                      >
                        {row.shopName}
                      </Link>
                      <Badge tone={SEVERITY_TONE[row.severity]} dot>
                        {SEVERITY_LABEL[row.severity]}
                      </Badge>
                      {row.suspendedAt ? <Badge tone="red">Suspended</Badge> : null}
                      {row.payoutsPausedAt ? (
                        <Badge tone="amber">Payouts held</Badge>
                      ) : null}
                      {row.deletedAt ? <Badge tone="neutral">Deleted</Badge> : null}
                      {row.openFlags > 0 ? (
                        <Badge tone="blue">
                          {row.openFlags} flag{row.openFlags === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-400">
                      /{row.handle} · {row.ownerEmail}
                    </p>
                  </div>

                  {mayAct ? (
                    <Link
                      href={`/accounts/${row.ownerId}/risk`}
                      className="focus-ring press inline-flex h-9 shrink-0 items-center rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50"
                    >
                      Work it
                    </Link>
                  ) : null}
                </div>

                {/*
                  Every finding, not just the loudest. A row showing one line
                  invites the reader to act on it and stop, and the shape that
                  actually decides what to do is the combination — a velocity
                  spike alone is a good week, and a velocity spike next to a
                  chargeback rate is something else.
                */}
                <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
                  {row.signals.map((signal) => (
                    <li
                      key={signal.kind}
                      className="flex items-start gap-2 text-sm leading-relaxed"
                    >
                      <Badge tone={SEVERITY_TONE[signal.severity]}>
                        {SEVERITY_LABEL[signal.severity]}
                      </Badge>
                      <span className="min-w-0 flex-1 text-ink-700">
                        {signal.summary}
                      </span>
                    </li>
                  ))}
                  {row.signals.length === 0 ? (
                    <li className="text-sm text-ink-500">
                      Nothing is tripping now — this is here because a staff
                      decision is still in force against it.
                    </li>
                  ) : null}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/*
        The blind spot, given its own section rather than left out.

        A returning owner cannot be a candidate above: the match is an HMAC
        under a key the database does not hold, so there is no SQL that finds
        "shops whose owner closed one before". This asks it the only way round —
        take the closures worth chasing, look up who is trading under that
        fingerprint now — and it is the single highest-value list on this page,
        because a seller who left buyers undelivered and came back under a new
        shop is the case nobody goes looking for.
      */}
      {returning.length > 0 ? (
        <>
          <SectionTitle>Trading again after a closure</SectionTitle>
          <Card className="divide-y divide-ink-100">
            {returning.map(({ account, prior }) => (
              <div
                key={account.shopId}
                className="flex flex-wrap items-start justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <Link
                    href={`/accounts/${account.userId}`}
                    className="focus-ring rounded font-medium text-ink-900 hover:text-brand-700"
                  >
                    {account.shopName}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-400">
                    /{account.handle} · opened <When value={account.createdAt} />
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
                    Same owner as <span className="font-mono text-xs">/{prior.handle}</span>,
                    closed <When value={prior.closedAt} />
                    {prior.undeliveredPaidOrders > 0
                      ? ` with ${prior.undeliveredPaidOrders} paid orders undelivered`
                      : ""}
                    {prior.disputeCount > 0
                      ? `${prior.undeliveredPaidOrders > 0 ? " and" : " with"} ${prior.disputeCount} chargeback${prior.disputeCount === 1 ? "" : "s"}`
                      : ""}
                    .
                  </p>
                </div>
                <Link
                  href={`/closures/${prior.id}`}
                  className="focus-ring press inline-flex h-9 shrink-0 items-center rounded-xl border border-ink-200 bg-white px-3 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50"
                >
                  The old shop
                </Link>
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <p className="mt-6 text-xs leading-relaxed text-ink-400">
        The desk measured {desk.scanned.toLocaleString()} shops — the ones that
        appear in a dispute, an undelivered paid order, an unusual week, an open
        flag or a standing staff decision. Everything else on the platform is
        not scored, deliberately: the cost of this page tracks what is wrong
        rather than how big Sailo has got.
      </p>
    </>
  );
}
