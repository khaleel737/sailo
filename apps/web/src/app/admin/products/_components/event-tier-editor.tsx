"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input } from "@sailo/design-system/web";
import { centsToAmount } from "@sailo/core/currency";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { MAX_TIERS } from "@sailo/core/tickets";
import type { EventTier } from "@sailo/db/schema";

/**
 * Early bird, General, VIP — different prices against one room, spec 50.
 *
 * WHY THIS IS NOT THE VARIANT EDITOR
 *
 * It looks like one and it deliberately is not. A variant is an *option
 * combination*: the rows are derived from `products.options`, so putting tiers
 * there would mint a fake option group that renders in the buyer's option
 * picker and appears in every variant matrix. The note above `eventTiers` in
 * the schema says so at length. Tiers are their own list, typed by hand, in the
 * seller's own order.
 *
 * THE ROW CARRIES ITS ID
 *
 * A tier holds `sold` — the seats already taken against it — so the server
 * matches rows by id rather than by name. Without the id in the payload a
 * seller fixing a typo in "VIP" would delete a band with thirty seats gone and
 * insert an empty one beside it, and the `event_tiers_not_oversold` constraint
 * would have nothing to object to because the row is new.
 *
 * The seats already sold are never posted, and there is no field for them here:
 * `sold` moves through `claimEventCapacity`'s conditional UPDATE and nowhere
 * else. Typing a capacity below it is refused by `saveProduct` with the count
 * in the sentence, which is the one number that says what to type instead.
 *
 * FOUR COLUMNS THIS DOES NOT RENDER
 *
 * `description`, `maxPerOrder` and the band's own `sellFrom` / `sellUntil` are
 * on the table and on `EventTierInput`, and nothing writes them: this is the
 * only editor tiers have. They are named here so the next screen that wants an
 * early-bird cutoff knows the column is waiting rather than missing.
 */

type Draft = {
  /** React's key. Stable across a rename, unlike the name. */
  key: string;
  /** Null on a band the seller has just added. */
  id: string | null;
  name: string;
  price: string;
  capacity: string;
  hidden: boolean;
};

let minted = 0;
const nextKey = () => `tier-new-${(minted += 1)}`;

function toDraft(tier: EventTier, currency: string): Draft {
  return {
    key: tier.id,
    id: tier.id,
    name: tier.name,
    price: centsToAmount(tier.priceCents, currency),
    // Null shares the room, and a blank box is how that reads.
    capacity: tier.capacity === null ? "" : String(tier.capacity),
    hidden: tier.isHidden,
  };
}

export function EventTierEditor({
  tiers,
  currency,
  /** The product's own price, shown as the placeholder a blank band inherits. */
  basePrice,
}: {
  tiers: EventTier[];
  currency: string;
  basePrice: string;
}) {
  const a = useAdminT();
  const [rows, setRows] = useState<Draft[]>(() =>
    tiers.map((tier) => toDraft(tier, currency)),
  );

  const patch = (key: string, next: Partial<Draft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  return (
    <div className="space-y-3">
      {/*
        One hidden field per row, as the variant and file editors post theirs.
        Not parallel `tierName[]` / `tierHidden[]` arrays: a browser omits an
        unchecked checkbox entirely, so unticking "hidden" on the second of
        four bands would shift the flag onto the third.
      */}
      {rows.map((row) => (
        <input
          key={`payload-${row.key}`}
          type="hidden"
          name="tiers"
          value={JSON.stringify({
            id: row.id,
            name: row.name,
            price: row.price,
            capacity: row.capacity,
            hidden: row.hidden,
          })}
        />
      ))}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-ink-200">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-medium text-ink-500">
                <th className="px-3 py-2">{a.productForm.tierName}</th>
                <th className="w-28 px-3 py-2">{a.productForm.tierPrice}</th>
                <th className="w-32 px-3 py-2">{a.productForm.tierCapacity}</th>
                <th className="w-20 px-3 py-2 text-center">
                  {a.productForm.tierHidden}
                </th>
                <th className="w-10 px-3 py-2">
                  {/* Named for a screen reader; an empty header reads as a
                      nameless column. */}
                  <span className="sr-only">{a.common.delete}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-3 py-2">
                    <Input
                      value={row.name}
                      maxLength={80}
                      aria-label={a.productForm.tierName}
                      placeholder="VIP"
                      onChange={(e) => patch(row.key, { name: e.target.value })}
                      className="h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      inputMode="decimal"
                      value={row.price}
                      placeholder={basePrice || "0.00"}
                      aria-label={a.productForm.tierPrice}
                      onChange={(e) => patch(row.key, { price: e.target.value })}
                      className="h-9"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      inputMode="numeric"
                      value={row.capacity}
                      /* A dash and not the room's count: blank means "share
                         the room", and a number here would read as one the
                         seller had already typed. */
                      placeholder="—"
                      aria-label={a.productForm.tierCapacity}
                      onChange={(e) => patch(row.key, { capacity: e.target.value })}
                      className="h-9"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.hidden}
                      aria-label={a.productForm.tierHidden}
                      onChange={(e) => patch(row.key, { hidden: e.target.checked })}
                      className="size-4 rounded border-ink-300 accent-ink-900"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${a.common.delete} ${row.name || a.productForm.tierName}`}
                      onClick={() =>
                        setRows((prev) => prev.filter((r) => r.key !== row.key))
                      }
                      className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rows.length < MAX_TIERS ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((prev) => [
              ...prev,
              {
                key: nextKey(),
                id: null,
                name: "",
                price: "",
                capacity: "",
                hidden: false,
              },
            ])
          }
        >
          <Plus className="size-4" />
          {a.common.add}
        </Button>
      ) : null}

      {/* Said once under the table rather than per row: it is the one thing
          about this editor a seller cannot work out by looking at it. */}
      <p className="text-xs text-ink-500">{a.productForm.tierCapacityHint}</p>
    </div>
  );
}
