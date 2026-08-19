"use client";

import Link from "next/link";
import { ArrowUpRight, Truck } from "lucide-react";
import { Card, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/**
 * What a physical product needs that the others don't: getting there, and not
 * running out of it.
 *
 * The tab had no card at all, which read as "physical products have no
 * settings" when the truth was that theirs were shop-wide. That is still true
 * of the *rates* — a seller sets up zones once and every product uses them, and
 * duplicating a rate table per product is how two sources of truth for postage
 * start — so the link stays.
 *
 * What spec 51 adds is the two things that genuinely are per product: what it
 * weighs, which is the input those shop-wide rates were missing, and the line
 * below which the seller wants telling.
 */
export function PhysicalSettingsCard({
  product,
  /** Whether the plan includes weight-banded rates, for the hint under weight. */
  weightBands = false,
}: {
  product?: ProductWithRelations;
  weightBands?: boolean;
}) {
  const a = useAdminT();

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500"
          >
            <Truck className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-900">
              {a.productForm.deliveryTitle}
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {a.productForm.deliveryBody}
            </p>
            <Link
              href="/admin/delivery"
              className="focus-ring mt-3 inline-flex items-center gap-1 rounded text-xs font-medium text-brand-700 transition hover:text-brand-800 pointer-coarse:min-h-11"
            >
              {a.productForm.deliverySettings}
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {a.productForm.parcelTitle}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {weightBands
              ? a.productForm.parcelBodyBands
              : a.productForm.parcelBody}
          </p>
        </div>

        {/*
          Grams and millimetres, with no unit picker.

          A second stored unit is a conversion every reader has to get right and
          one of them eventually will not — the same argument that keeps money
          in minor units. A seller who thinks in ounces is served by the label,
          which says grams, and by a calculator.
        */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={a.productForm.weightGrams}
            htmlFor="weightGrams"
            hint={a.common.optional}
            help={a.productForm.weightGramsHint}
          >
            <Input
              id="weightGrams"
              name="weightGrams"
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={product?.weightGrams ?? ""}
              placeholder="350"
            />
          </Field>

          <Field
            label={a.productForm.lowStockThreshold}
            htmlFor="lowStockThreshold"
            hint={a.common.optional}
            help={a.productForm.lowStockThresholdHint}
          >
            <Input
              id="lowStockThreshold"
              name="lowStockThreshold"
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={product?.lowStockThreshold ?? ""}
              placeholder="5"
            />
          </Field>
        </div>

        {/*
          Dimensions sit under weight rather than beside it because they are the
          less-used half: a band table prices on weight, and size matters only
          where a carrier charges volumetrically. Three fields on one row so
          they read as one measurement rather than three settings.
        */}
        <Field label={a.productForm.dimensionsMm} hint={a.common.optional}>
          <div className="grid grid-cols-3 gap-2">
            <Input
              name="lengthMm"
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={a.productForm.lengthMm}
              defaultValue={product?.lengthMm ?? ""}
              placeholder={a.productForm.lengthMm}
            />
            <Input
              name="widthMm"
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={a.productForm.widthMm}
              defaultValue={product?.widthMm ?? ""}
              placeholder={a.productForm.widthMm}
            />
            <Input
              name="heightMm"
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={a.productForm.heightMm}
              defaultValue={product?.heightMm ?? ""}
              placeholder={a.productForm.heightMm}
            />
          </div>
        </Field>
      </Card>
    </>
  );
}
