import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { requireShop } from "@/lib/session";
import { waitingFor } from "@sailo/commerce/catalog";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { Card, PageHeader } from "@sailo/design-system/web";
import { absolute } from "@sailo/core/origin";

export const metadata: Metadata = { title: "Waiting for stock" };

/**
 * Who is waiting, and the one thing the seller can do about the half of them
 * Sailo cannot reach — spec 33.
 *
 * WHY THIS SCREEN EXISTS AT ALL
 *
 * The email half needs no screen: a restock claims the queue and sends. This is
 * for the phone-only half, and it exists because **Sailo does not send to a
 * phone**. There is no WhatsApp Business API here and no SMS provider, and
 * pretending otherwise would be a promise the platform cannot keep.
 *
 * So the seller sends, from their own number, in a thread the buyer recognises.
 * That reaches every country, costs nothing, needs no approval, and is more
 * likely to be read than any email. One tap, with the message already written.
 *
 * OLDEST FIRST, AND IT SAYS SO
 *
 * If forty people are waiting for twelve units, "I asked first" is the only
 * fair reading that does not need explaining — and the list has to be in the
 * same order the emails go out in, or a seller reads two different answers to
 * "who is next".
 *
 * WHAT IT DOES NOT SHOW
 *
 * The buyer never sees any of this. "23 waiting" is a number about the seller's
 * shop, not about the person reading a product page, and a nudge built out of
 * somebody else's data is what spec 33 refuses by name.
 */
export default async function WaitingPage() {
  const { a } = await getAdminT();
  const { shop } = await requireShop();

  const waiting = await waitingFor(shop.id);
  const byPhone = waiting.filter((row) => !row.email && row.phone);

  return (
    <>
      <PageHeader
        title={a.products.waitingTitle}
        description={interpolate(a.products.waitingDescription, {
          count: waiting.length,
        })}
      />

      {waiting.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-ink-500">{a.products.waitingEmpty}</p>
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100">
          {waiting.map((row) => {
            const what = row.variantLabel
              ? `${row.productTitle} — ${row.variantLabel}`
              : row.productTitle;

            /*
             * The message, already written, in the seller's own words.
             *
             * It says the thing is *available*, never that it is held: anybody
             * can buy the restocked unit and being told first is the whole of
             * what was promised. Copy claiming otherwise is the lie spec 33
             * exists to prevent, and it reads worse coming from a person than
             * from a system.
             */
            const message = interpolate(a.products.waitingWhatsapp, {
              shop: shop.name,
              item: what,
              url: absolute(`/${shop.handle}`),
            });

            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{what}</p>
                  <p className="text-xs text-ink-500">
                    {row.email ?? row.phone}
                    {" · "}
                    {row.createdAt.toLocaleDateString()}
                  </p>
                </div>

                {row.email ? (
                  /* Nothing to do: the restock claims this row and sends. */
                  <span className="text-xs text-ink-500">{a.products.waitingByEmail}</span>
                ) : row.phone ? (
                  <a
                    /*
                     * `wa.me` with the message pre-filled — the same handoff the
                     * checkout already uses. The seller presses send; Sailo does
                     * not, and cannot.
                     */
                    href={`https://wa.me/${row.phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-emerald-700 pointer-coarse:min-h-11"
                  >
                    <MessageCircle className="size-3.5" />
                    {a.products.waitingMessageThem}
                  </a>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}

      {byPhone.length > 0 ? (
        <p className="mt-3 text-xs text-ink-500">
          {interpolate(a.products.waitingPhoneNote, { count: byPhone.length })}
        </p>
      ) : null}
    </>
  );
}
