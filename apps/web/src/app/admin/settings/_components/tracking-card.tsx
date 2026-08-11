"use client";

import { Card, Field, Input } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { PIXEL_PROVIDERS } from "@/lib/shop-pixels";
import type { Shop } from "@sailo/db/schema";

/**
 * The seller's own tracking tags — ids only, never snippets.
 *
 * Four named fields rather than a "paste your code" box, on purpose: a
 * snippet box on a multi-tenant platform is every seller holding a `<script>`
 * tag on our origin. The ids are shape-checked in `lib/shop-pixels.ts` and
 * the storefront builds the scripts itself, so this card can exist without
 * anyone being able to run code on a buyer's page.
 */
export function TrackingCard({ shop }: { shop: Shop }) {
  const a = useAdminT();

  const fields = [
    {
      spec: PIXEL_PROVIDERS.ga4,
      label: a.settings.ga4Label,
      hint: a.settings.ga4Hint,
      value: shop.ga4MeasurementId,
    },
    {
      spec: PIXEL_PROVIDERS.gtm,
      label: a.settings.gtmLabel,
      hint: a.settings.gtmHint,
      value: shop.gtmContainerId,
    },
    {
      spec: PIXEL_PROVIDERS.meta,
      label: a.settings.metaPixelLabel,
      hint: a.settings.metaPixelHint,
      value: shop.metaPixelId,
    },
    {
      spec: PIXEL_PROVIDERS.tiktok,
      label: a.settings.tiktokPixelLabel,
      hint: a.settings.tiktokPixelHint,
      value: shop.tiktokPixelId,
    },
  ];

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.settings.tracking}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.trackingBody}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map(({ spec, label, hint, value }) => (
          <Field key={spec.field} label={label} htmlFor={spec.field} hint={hint}>
            <Input
              id={spec.field}
              name={spec.field}
              defaultValue={value ?? ""}
              placeholder={spec.example}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ))}
      </div>

      <p className="text-xs text-ink-500">{a.settings.trackingConsentNote}</p>
    </Card>
  );
}
