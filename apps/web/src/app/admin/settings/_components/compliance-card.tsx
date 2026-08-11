"use client";

import { Card, Field, Input } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { Shop } from "@sailo/db/schema";

/**
 * The two checkout compliance switches.
 *
 * Deliberately not plan-gated. Everything else in this form that costs money
 * to unlock is a way to sell more; this is the seller meeting an obligation
 * they already have, and putting a price on that would mean the cheapest shops
 * are the ones that cannot ask for consent.
 */
export function ComplianceCard({ shop }: { shop: Shop }) {
  const a = useAdminT();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.settings.compliance}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.complianceBody}</p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
        <input
          type="checkbox"
          name="requireTerms"
          defaultChecked={shop.requireTerms}
          className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
        />
        <span>
          <span className="block text-sm font-medium">
            {a.settings.requireTerms}
          </span>
          <span className="block text-xs text-ink-500">
            {a.settings.requireTermsBody}
          </span>
        </span>
      </label>

      <Field
        label={a.settings.termsUrl}
        htmlFor="termsUrl"
        hint={a.settings.termsUrlHint}
      >
        <Input
          id="termsUrl"
          name="termsUrl"
          type="url"
          inputMode="url"
          defaultValue={shop.termsUrl ?? ""}
          placeholder="https://example.com/terms"
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
        <input
          type="checkbox"
          name="askMarketingConsent"
          defaultChecked={shop.askMarketingConsent}
          className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
        />
        <span>
          <span className="block text-sm font-medium">
            {a.settings.askMarketingConsent}
          </span>
          <span className="block text-xs text-ink-500">
            {a.settings.askMarketingConsentBody}
          </span>
        </span>
      </label>
    </Card>
  );
}
