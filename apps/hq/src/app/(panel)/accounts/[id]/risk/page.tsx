import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@sailo/design-system/web";
import { SectionTitle, When } from "@/app/_components/hq-ui";
import { ClearFlag, RaiseFlag } from "../../../risk/_components/flag-controls";
import { getAccountHeader, getShopRisk, priorClosuresFor } from "@/lib/platform";
import { staffCan } from "@/lib/session";
import { reputationFor } from "@sailo/marketing/broadcasts/server";
import type { RiskSeverity } from "@sailo/core/risk";

export const metadata: Metadata = { title: "Risk" };

const TONE: Record<RiskSeverity, "red" | "amber" | "neutral"> = {
  act: "red",
  review: "amber",
  watch: "neutral",
};

const LABEL: Record<RiskSeverity, string> = {
  act: "Act",
  review: "Review",
  watch: "Watch",
};

/**
 * One shop's risk picture, and the record of what people decided about it.
 *
 * ─── THREE THINGS, IN THE ORDER THEY ARE ASKED ───────────────────────────────
 * What is tripping now, what somebody already flagged, and whether this owner
 * has done this before. The third is the one no other screen can answer: the
 * match runs on a keyed digest of the address, so it survives an owner deleting
 * a shop and signing up again with the same inbox — which is the whole reason
 * `shop_closures` exists.
 *
 * The findings are computed by the same `getShopRisk` the desk runs, over the
 * same `assessRisk` ladder. Two implementations of "how risky is this shop" is
 * how a shop comes to look clean on its own page and alarming on the list, and
 * whichever one somebody happened to open becomes the decision.
 *
 * Cleared flags are shown, not hidden. The question after something goes wrong
 * is "did anybody see this coming, and what did they say" — and a screen that
 * quietly drops dismissed findings cannot answer it.
 */
export default async function HqAccountRiskPage({
  params,
}: PageProps<"/accounts/[id]/risk">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header?.shop) notFound();

  const { owner, shop } = header;

  const [risk, closures, mayFlag, reputation] = await Promise.all([
    getShopRisk(shop.id),
    priorClosuresFor(owner.email),
    staffCan("account:suspend"),
    /*
     * The decision-grade numbers — the same window `evaluateShop` pauses on,
     * clearance watermark included — so the person deciding whether to lift
     * a pause reads the rate that caused it, not a guess.
     */
    reputationFor(shop.id),
  ]);

  const open = risk?.flags.filter((f) => !f.clearedAt) ?? [];
  const cleared = risk?.flags.filter((f) => f.clearedAt) ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <SectionTitle>What the numbers say</SectionTitle>
          {!risk || risk.signals.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm font-medium text-ink-900">
                Nothing is tripping.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                No chargeback rate, refund share, delivery gap, velocity change
                or policy match on this shop is past the level worth
                interrupting somebody over. The ladder is re-read on every
                visit, so this is current rather than remembered.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-ink-100">
              {risk.signals.map((signal) => (
                <div key={signal.kind} className="flex items-start gap-3 p-4">
                  <Badge tone={TONE[signal.severity]}>
                    {LABEL[signal.severity]}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-ink-900">
                      {signal.summary}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {signal.kind.replace(/_/g, " ")} · {signal.evidence}
                    </p>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div>
          <SectionTitle>Flags — {open.length} open</SectionTitle>
          {risk?.flags.length === 0 ? (
            <Card className="p-5">
              <p className="text-sm text-ink-500">
                Nobody has flagged this shop.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-ink-100">
              {[...open, ...cleared].map((flag) => (
                <div key={flag.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            flag.clearedAt
                              ? "neutral"
                              : TONE[flag.severity as RiskSeverity]
                          }
                        >
                          {flag.clearedAt
                            ? "Cleared"
                            : LABEL[flag.severity as RiskSeverity]}
                        </Badge>
                        <span className="text-xs text-ink-400">
                          {flag.kind.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-900">
                        {flag.summary}
                      </p>
                      <p className="mt-1 text-xs text-ink-400">
                        raised <When value={flag.raisedAt} withTime />
                        {flag.raisedByEmail ? ` by ${flag.raisedByEmail}` : " by the desk"}
                      </p>
                      {flag.clearedAt ? (
                        <p className="mt-1 text-xs leading-relaxed text-ink-500">
                          Cleared <When value={flag.clearedAt} withTime />
                          {flag.clearedByEmail ? ` by ${flag.clearedByEmail}` : ""}
                          {flag.clearedReason ? ` — ${flag.clearedReason}` : ""}
                        </p>
                      ) : null}
                    </div>

                    {!flag.clearedAt && mayFlag ? (
                      <div className="shrink-0">
                        <ClearFlag flagId={flag.id} />
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        {closures.length > 0 ? (
          <div>
            {/*
              The finding no other screen can produce. Matched on a keyed digest
              of this owner's address, so it holds across a deleted shop and a
              fresh signup with the same inbox — which is exactly the move this
              whole feature was built to catch.
            */}
            <SectionTitle>This owner has closed a shop before</SectionTitle>
            <Card className="divide-y divide-ink-100">
              {closures.map((closure) => (
                <Link
                  key={closure.id}
                  href={`/closures/${closure.id}`}
                  className="focus-ring flex flex-wrap items-center justify-between gap-2 p-4 text-sm transition hover:bg-ink-50"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-ink-600">
                      /{closure.handle}
                    </span>
                    <span className="ms-2 text-ink-500">
                      closed <When value={closure.closedAt} />
                      {closure.closedBy === "staff" ? " by us" : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {closure.undeliveredPaidOrders > 0 ? (
                      <Badge tone="red">
                        {closure.undeliveredPaidOrders} undelivered
                      </Badge>
                    ) : null}
                    {closure.disputeCount > 0 ? (
                      <Badge tone="amber">
                        {closure.disputeCount} chargeback
                        {closure.disputeCount === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                    {closure.identityRetained === "suspicion" ? (
                      <Badge tone="amber">Under suspicion</Badge>
                    ) : (
                      <Badge tone="neutral">Clean</Badge>
                    )}
                  </span>
                </Link>
              ))}
            </Card>
          </div>
        ) : null}
      </div>

      <aside className="min-w-0 space-y-3">
        {mayFlag ? (
          <RaiseFlag shopId={shop.id} />
        ) : (
          <Card className="p-4">
            <p className="text-xs leading-relaxed text-ink-500">
              Flagging a shop needs a role you don&rsquo;t hold. Everything on
              this tab is readable — write what you saw as an internal note on
              the Overview tab and say so to whoever works the desk.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-400">
            Standing
          </h3>
          <div className="space-y-2 text-sm">
            <p className="text-ink-700">
              {shop.suspendedAt
                ? "Suspended — the storefront is offline."
                : "Trading."}
            </p>
            <p className="text-ink-700">
              {shop.payoutsPausedAt
                ? "Payouts held — the balance stays on the connected account."
                : "Payouts running normally."}
            </p>
            <p className="text-ink-700">
              {shop.marketingPausedAt
                ? "Marketing paused — broadcasts are held."
                : "Marketing allowed."}
            </p>
            <p className="text-xs leading-relaxed text-ink-500">
              {reputation.sent.toLocaleString()} marketing emails in the last 30
              days{shop.marketingClearedAt ? " (since the last clearance)" : ""}:{" "}
              {reputation.complaints} spam complaint
              {reputation.complaints === 1 ? "" : "s"} (
              {(reputation.complaintRate * 100).toFixed(2)}%),{" "}
              {reputation.bounces} bounce
              {reputation.bounces === 1 ? "" : "s"} (
              {(reputation.bounceRate * 100).toFixed(1)}%). The automatic pause
              trips at 0.10% complaints or 5% bounces over 100 sends.
            </p>
            {shop.disputeClearedAt ? (
              <p className="text-xs leading-relaxed text-ink-500">
                Disputes were reviewed and cleared{" "}
                <When value={shop.disputeClearedAt} />. Two further chargebacks
                reopen that.
              </p>
            ) : null}
          </div>
        </Card>

        {shop.staffNote ? (
          <Card className="p-4">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">
              Internal note
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
              {shop.staffNote}
            </p>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
