import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@sailo/design-system/web";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { dataRequestQueue } from "@sailo/account/data-requests";
import { RequestRow } from "./_components/request-row";

export const metadata: Metadata = { title: "Data requests" };

/**
 * The statutory queue. Spec 52.
 *
 * Sorted by `dueBy` — live requests first, soonest deadline at the top — because
 * the deadline is the only thing here that cannot be recovered. A request
 * answered on day thirty-one is not answered.
 *
 * Unverified rows are deliberately absent: until the address confirms, there is
 * no request from anybody, and a queue that showed them would let a stranger
 * fill a seller's screen by typing addresses into a public form.
 *
 * No plan gate. A compliance obligation is not an upsell, and gating it would
 * mean the shops least able to pay are the ones that cannot answer.
 */
export default async function AdminDataRequestsPage() {
  const { shop } = await requireShop();
  const [requests, { a }] = await Promise.all([
    dataRequestQueue(shop.id),
    getAdminT(),
  ]);

  return (
    <>
      <PageHeader title={a.dataRequests.title} description={a.dataRequests.intro} />

      {requests.length === 0 ? (
        <EmptyState
          title={a.dataRequests.empty}
          description={a.dataRequests.emptyBody}
        />
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} />
          ))}
        </div>
      )}
    </>
  );
}
