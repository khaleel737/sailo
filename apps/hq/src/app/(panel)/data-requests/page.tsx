import type { Metadata } from "next";
import { PageHeader, Badge, Card, EmptyState } from "@sailo/design-system/web";
import { requireStaff } from "@/lib/session";
import { can } from "@sailo/security/staff";
import { allDataRequests } from "@sailo/account/data-requests";
import { daysLeft, REFUSAL_REASONS } from "@sailo/core/privacy";
import { When } from "@/app/_components/hq-ui";
import { StaffAnswer } from "./_components/staff-answer";

export const metadata: Metadata = { title: "Data requests" };

/**
 * Every shop's buyer data requests, in one deadline queue. Spec 52.
 *
 * ─── WHY HQ HAS THIS AT ALL ─────────────────────────────────────────────────
 * The seller is the controller and answers their own requests; that is the
 * seller's screen. But a buyer may also have a claim against **Sailo** as
 * processor, and a seller can vanish, refuse, or simply not answer — while the
 * statutory clock does not stop for any of those. So the queue exists here too,
 * shop-scoped row by row.
 *
 * ─── AND WHY IT CANNOT ANSWER QUIETLY ───────────────────────────────────────
 * *"HQ must not be able to answer on a seller's behalf without recording that
 * it did."* Two mechanisms, and both are needed:
 *
 *   - the act is gated on `privacy:act`, a named capability that is neither
 *     `read` nor `data:export` — the auto-memory rule is explicit that every HQ
 *     write names one, and this hole has shipped once;
 *   - the acting address is written into `data_requests.actor` as
 *     `sailo:staff:<address>`, so "the seller answered" and "we answered for
 *     them" are never the same row.
 *
 * The page itself is `read`, because seeing the platform's outstanding
 * obligations is exactly what a support shift is for. Acting is the narrower
 * question and it is asked at the action.
 */
export default async function HqDataRequestsPage() {
  const staff = await requireStaff("read");
  const rows = await allDataRequests();

  return (
    <>
      <PageHeader
        title="Data requests"
        description="Buyers asking sellers for a copy of their data, or for it to be deleted. Sorted by the statutory deadline — 30 days from the moment the buyer confirmed their address."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing outstanding"
          description="Requests appear here as soon as a buyer confirms their email address on a shop's form."
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ request, shopName, shopHandle }) => {
            const left = daysLeft(request.dueBy);
            const answered =
              request.status === "fulfilled" || request.status === "refused";

            return (
              <Card key={request.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {request.email}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {shopName} · /{shopHandle}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{request.kind}</Badge>
                    {answered ? (
                      <Badge tone={request.status === "refused" ? "amber" : "green"} dot>
                        {request.status}
                      </Badge>
                    ) : (
                      <Badge tone={left !== null && left <= 7 ? "red" : "blue"} dot>
                        {left === null
                          ? "unverified"
                          : left < 0
                            ? `${Math.abs(left)}d overdue`
                            : `${left}d left`}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-ink-500">
                  <span>
                    Confirmed <When value={request.verifiedAt} />
                  </span>
                  {request.actor ? (
                    /*
                     * Who answered, always shown. A staff answer reads
                     * `sailo:staff:<address>` and a seller's reads as their own
                     * email — the distinction is the whole reason the column
                     * exists, so it is on the row rather than in a log.
                     */
                    <span>Answered by {request.actor}</span>
                  ) : null}
                  {request.refusedReason ? (
                    <span>
                      {REFUSAL_REASONS.find((r) => r.id === request.refusedReason)
                        ?.label ?? request.refusedReason}
                    </span>
                  ) : null}
                </div>

                {answered ? null : (
                  <StaffAnswer
                    requestId={request.id}
                    kind={request.kind}
                    /*
                     * The buttons are hidden from somebody who cannot use them,
                     * and the action checks again regardless. Hiding is a
                     * courtesy; the capability check in the action is the
                     * control.
                     */
                    canAct={can(staff.role, "privacy:act")}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
