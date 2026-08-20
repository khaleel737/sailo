"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShopTracking } from "@/lib/actions/shop";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { useSaveBar } from "@/app/admin/_components/save-bar";
import { PIXEL_PROVIDERS } from "@sailo/customers/pixels";
import type { Shop } from "@sailo/db/schema";

/**
 * The seller's tracking tags — ids only, never snippets — as their own
 * settings section, Shopify's "Customer events" grammar.
 *
 * These four fields used to sit at the bottom of Shop details; the user's
 * complaint was exact — "pixels are in analytics" is where a seller looks
 * for them. Moving them also closed a real hole: the old form rendered four
 * of the seven providers while the save wrote all seven, so every save
 * nulled the Google Ads, LinkedIn and Pinterest ids. All seven render here,
 * and the save behind this form touches only these columns.
 *
 * Named fields rather than a "paste your code" box, still: a snippet box on
 * a multi-tenant platform is every seller holding a `<script>` on our
 * origin. Ids are shape-checked server-side; the storefront builds the
 * scripts itself.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function TrackingForm({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(updateShopTracking, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  /*
   * A successful save is the one thing that makes the form clean again —
   * reconciled during render so the bar clears in the same paint. Tracked by
   * state identity, not the ok flag: `useActionState` returns a fresh object
   * per completed action, while `ok` stays true across consecutive saves —
   * a flag comparison cleared the bar once and never again.
   */
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) setDirty(false);
  }

  useSaveBar(dirty, {
    label: a.saveBar.unsaved,
    saving: pending,
    onSave: () => formRef.current?.requestSubmit(),
    onDiscard: () => {
      formRef.current?.reset();
      setDirty(false);
    },
  });


  const fields = [
    { spec: PIXEL_PROVIDERS.ga4, label: a.settings.ga4Label, hint: a.settings.ga4Hint, value: shop.ga4MeasurementId },
    { spec: PIXEL_PROVIDERS.gtm, label: a.settings.gtmLabel, hint: a.settings.gtmHint, value: shop.gtmContainerId },
    { spec: PIXEL_PROVIDERS.meta, label: a.settings.metaPixelLabel, hint: a.settings.metaPixelHint, value: shop.metaPixelId },
    { spec: PIXEL_PROVIDERS.tiktok, label: a.settings.tiktokPixelLabel, hint: a.settings.tiktokPixelHint, value: shop.tiktokPixelId },
    { spec: PIXEL_PROVIDERS.googleAds, label: a.settings.googleAdsLabel, hint: a.settings.googleAdsHint, value: shop.googleAdsId },
    { spec: PIXEL_PROVIDERS.linkedin, label: a.settings.linkedinLabel, hint: a.settings.linkedinHint, value: shop.linkedinPartnerId },
    { spec: PIXEL_PROVIDERS.pinterest, label: a.settings.pinterestLabel, hint: a.settings.pinterestHint, value: shop.pinterestTagId },
  ];

  return (
    <form ref={formRef} action={action} onInput={() => setDirty(true)} className="space-y-5">
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <Card className="space-y-4 p-5">
        <p className="text-xs leading-relaxed text-ink-500">
          {a.settings.trackingBody}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(({ spec, label, hint, value }) => (
            <Field key={spec.field} label={label} htmlFor={spec.field} hint={hint}>
              <Input
                id={spec.field}
                name={spec.field}
                defaultValue={value ?? ""}
                placeholder={spec.example}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          {a.settings.trackingConsentNote}
        </p>
      </Card>

      <Submit label={a.common.saveChanges} />
    </form>
  );
}
