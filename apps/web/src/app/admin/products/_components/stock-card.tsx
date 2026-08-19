"use client";

import { Card, Field, Input } from "@sailo/design-system/web";
import { MAX_QUANTITY, type ProductKind } from "@sailo/core/variants";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { Toggle } from "./toggle";
import { VariantEditor } from "./variant-editor";
import type { ProductWithRelations } from "./product.types";

/**
 * What there is to sell, and how much of it one person may take.
 *
 * Shared by four of the five kinds and worded differently for each, because
 * the same three controls mean genuinely different things: a shirt's options
 * are sizes, an event's are ticket tiers, a service's are session lengths, and
 * the count underneath is a shelf, a room and a diary in turn. One component
 * so the behaviour cannot drift between them; one dictionary lookup per kind
 * so the seller is not asked to translate "stock" into "capacity" themselves.
 *
 * A membership has none of this and is not given the card. It is one thing at
 * one price, sold one at a time — Stripe prices the product, `resolveLines`
 * forces the quantity to one, and stock that counted down on every renewal
 * would close a gym to its own members at the end of the first month.
 */
export function StockCard({
  kind,
  product,
  currency,
  price,
  trackInventory,
  onTrackInventoryChange,
  regionalCurrencies = [],
}: {
  kind: Exclude<ProductKind, "membership">;
  product?: ProductWithRelations;
  currency: string;
  /** The base price, shown as the placeholder each variant inherits. */
  price: string;
  trackInventory: boolean;
  onTrackInventoryChange: (next: boolean) => void;
  /**
   * The other currencies the shop quotes — spec 53.
   *
   * Passed straight through to the variant table, which grows a price column
   * per currency. A variant that overrides the product's price needs an
   * override in each of them, or the currency has a gap and is quoted to
   * nobody.
   */
  regionalCurrencies?: string[];
}) {
  const a = useAdminT();
  const event = kind === "event";

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {event ? a.productForm.capacityTitle : a.productForm.optionsTitle}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
          {event ? a.productForm.capacityBody : a.productForm.optionsBody}
        </p>
      </div>

      <Toggle
        name="trackInventory"
        label={event ? a.productForm.trackCapacity : a.productForm.trackStock}
        description={
          event ? a.productForm.trackCapacityBody : a.productForm.trackStockBody
        }
        checked={trackInventory}
        onChange={onTrackInventoryChange}
      />

      <VariantEditor
        options={product?.options ?? []}
        variants={product?.variants ?? []}
        currency={currency}
        basePrice={price}
        trackInventory={trackInventory}
        stockQuantity={product?.stockQuantity ?? null}
        sku={product?.sku ?? null}
        regionalCurrencies={regionalCurrencies}
      />

      {/*
        The cap, and it is not a stock field.
        
        Stock says how many exist; this says how many one person may have at
        once, and an event needs both — a room of 200 that also refuses anybody
        a fifth seat. Sitting under the stock controls rather than beside the
        price because that is where a seller looks for "how many", and blank
        means the only limit is supply.
      */}
      <Field
        label={a.productForm.maxPerOrder}
        htmlFor="maxPerOrder"
        hint={a.common.optional}
        help={
          event ? a.productForm.maxPerOrderEventHint : a.productForm.maxPerOrderHint
        }
      >
        <Input
          id="maxPerOrder"
          name="maxPerOrder"
          type="number"
          min={1}
          max={MAX_QUANTITY}
          inputMode="numeric"
          defaultValue={product?.maxPerOrder ?? ""}
          placeholder={event ? "4" : "10"}
          className="sm:w-40"
        />
      </Field>
    </Card>
  );
}
