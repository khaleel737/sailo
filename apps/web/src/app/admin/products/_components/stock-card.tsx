"use client";

import { useState } from "react";
import { Card, Field, Input } from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { localMoment } from "@/app/admin/products/_lib/local-moment";
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
  timeZone = "UTC",
  trackInventory,
  onTrackInventoryChange,
  regionalCurrencies = [],
}: {
  kind: Exclude<ProductKind, "membership">;
  product?: ProductWithRelations;
  currency: string;
  /** The base price, shown as the placeholder each variant inherits. */
  price: string;
  /** The shop's zone, so the preorder date means the seller's own calendar. */
  timeZone?: string;
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
  const [preorder, setPreorder] = useState(product?.preorderEnabled ?? false);

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
        Selling what there is none of — spec 33.

        Here rather than in a card of its own, because it is an answer to the
        question this card already asks: what is there to sell, and what happens
        when there is not. A seller reading "track stock" is one line away from
        wanting to know what a buyer sees when it runs out.

        The date is the whole risk the feature adds. Charging at checkout for
        goods that arrive six weeks later is a chargeback waiting to happen if
        the buyer was never told six weeks — so it is shown before they commit
        and snapshotted onto the order, and leaving it blank renders as "no date
        yet" rather than as nothing.
      */}
      <div className="space-y-4 border-t border-ink-100 pt-4">
        <Toggle
          name="preorderEnabled"
          label={a.productForm.preorderEnabled}
          description={a.productForm.preorderEnabledBody}
          checked={preorder}
          onChange={setPreorder}
        />

        {preorder ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={a.productForm.preorderExpectedAt}
              htmlFor="preorderExpectedAt"
              hint={a.common.optional}
              help={interpolate(a.productForm.preorderExpectedAtHint, {
                zone: timeZone,
              })}
            >
              <Input
                id="preorderExpectedAt"
                name="preorderExpectedAt"
                type="datetime-local"
                defaultValue={localMoment(product?.preorderExpectedAt ?? null, timeZone)}
              />
            </Field>
            <Field
              label={a.productForm.preorderLimit}
              htmlFor="preorderLimit"
              hint={a.common.optional}
              help={a.productForm.preorderLimitHint}
            >
              <Input
                id="preorderLimit"
                name="preorderLimit"
                type="number"
                min={1}
                inputMode="numeric"
                defaultValue={product?.preorderLimit ?? ""}
                placeholder="50"
              />
            </Field>
          </div>
        ) : null}
      </div>

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
