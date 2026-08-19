import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { products, type Order } from "@sailo/db/schema";
import { deliveryOf, type DigitalDelivery } from "@sailo/core/variants";
import { codesForOrder, isCodeSource } from "../catalog/code-pool";
import { orderLines } from "./order-lines";

/**
 * What a digital order hands over when the good is not a file.
 *
 * Files already had a path of their own: they are rows in `product_files`,
 * streamed by a route that re-checks the order on every byte. A link and a
 * code have no bytes to stream — they are strings that *are* the good — and
 * they need the identical gate, so they get the identical shape here.
 *
 * The gate lives inside this function, exactly as it does in
 * `eventAccessForOrder`. Handing a caller the string and a boolean saying
 * whether they may show it is a rule somebody eventually forgets; asking for
 * the access and getting `value: null` until the order is released is a rule
 * nobody can forget, because there is nothing to leak.
 */

export type DigitalAccess = {
  productId: string;
  title: string;
  delivery: Exclude<DigitalDelivery, "file">;
  /** The link or the code. Null until the order is released. */
  value: string | null;
  /**
   * Every code this order was given for this product — spec 48.
   *
   * A buyer who bought three licences has three strings, so a single `value`
   * cannot describe them. `value` stays the first one so nothing rendering it
   * breaks; anything that wants all of them reads this.
   *
   * Empty for a shared code, which is `value` and nothing more.
   */
  values: string[];
  /** True while the order has not been released, so the buyer can be told. */
  locked: boolean;
};

export async function digitalAccessForOrder(order: Order): Promise<DigitalAccess[]> {
  const lines = await orderLines(order);

  /*
   * From the lines, never from `order.productKind` — that column describes the
   * order's *first* line, so a basket holding a mug and an ebook reads as
   * "physical" and the buyer never sees what they bought.
   */
  const ids = [
    ...new Set(
      lines
        .filter((line) => line.kind === "digital")
        .map((line) => line.productId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return [];

  const rows = await getDb().query.products.findMany({
    where: inArray(products.id, ids),
    columns: {
      id: true,
      title: true,
      kind: true,
      digitalDelivery: true,
      digitalLinkUrl: true,
      digitalAccessDetails: true,
      codeSource: true,
    },
  });

  const released = order.downloadReleasedAt !== null;

  /*
   * The codes this order was actually given — spec 48.
   *
   * Read by order, so nothing here can reach a code belonging to anybody else
   * and nothing here can reach an unclaimed one: `codesForOrder` filters on
   * `claimed_by_order_id`, which is the only handle this page has.
   *
   * Read unconditionally rather than inside the loop, because a basket with
   * four pooled products would otherwise be four queries — and read even when
   * the order is not released, because the *count* is what tells a buyer how
   * many codes are coming while the strings stay hidden.
   */
  const claimed = new Map<string, string[]>();
  for (const row of await codesForOrder(order.id)) {
    if (row.revokedAt) continue;
    const list = claimed.get(row.productId) ?? [];
    list.push(row.code);
    claimed.set(row.productId, list);
  }

  return rows.flatMap((product) => {
    const delivery = deliveryOf(product);
    // Files are the other path; they are not access to be rendered as text.
    if (delivery === "file") return [];

    /*
     * A pooled product's good is the buyer's own codes, never the shared
     * string. Falling back to `digitalAccessDetails` when the pool came up
     * empty would hand every buyer of a sold-out pool the seller's own
     * template text, which is at best confusing and at worst the one string
     * they kept for themselves.
     */
    const pooled = isCodeSource(product.codeSource);
    const values = pooled
      ? (claimed.get(product.id) ?? [])
      : [
          (delivery === "link"
            ? product.digitalLinkUrl
            : product.digitalAccessDetails) ?? "",
        ].filter(Boolean);

    /*
     * A pooled product always renders, even with nothing claimed yet.
     *
     * Before release there is deliberately nothing in `values` — the code is
     * spent at release, not at checkout — so dropping the entry for having no
     * strings would leave the buyer of a licence key looking at a page with
     * nothing on it and no explanation, which is exactly the state this block
     * exists to explain. A shared code is different: nothing stored is nothing
     * the seller ever meant to hand over.
     *
     * `locked` is true whenever there is nothing to show, released or not. The
     * one case where that reads slightly wrong is a released order whose pool
     * had run dry — the copy says "once the seller confirms your payment" when
     * the real answer is "the seller has run out". That is the better of the
     * two failures: it points the buyer at the seller, which is where the fix
     * is, and the seller sees the shortfall on their own pool screen.
     */
    if (values.length === 0 && !pooled) return [];

    return [
      {
        productId: product.id,
        title: product.title,
        delivery,
        value: released ? (values[0] ?? null) : null,
        values: released ? values : [],
        locked: !released || values.length === 0,
      },
    ];
  });
}
