"use client";

import { useState } from "react";
import { Card, Field, Input } from "@sailo/design-system/web";
import { descriptorPreview } from "@sailo/core/disputes";
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
  /*
   * Held in state for one reason: the preview underneath.
   *
   * Stripe *silently ignores* an invalid descriptor — the charge succeeds and
   * the account default is used instead — so the failure this field exists to
   * prevent is a seller who typed something, was never told it would not be
   * used, and finds out from an `unrecognized` chargeback months later. The
   * save refuses an invalid one, but a refusal costs a round trip; this shows
   * the exact line the buyer will read while they are still looking at it.
   */
  const [descriptor, setDescriptor] = useState(shop.statementDescriptor ?? "");
  const preview = descriptorPreview(descriptor, null);

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

      {/*
        The statement descriptor sits with the compliance switches rather than
        with the payment rails, because it is the same kind of thing: something
        the seller owes the buyer at checkout. Spec 44 — it is the only dispute
        reason a seller can eliminate outright rather than argue after the fact.
      */}
      <Field
        label={a.settings.statementDescriptor}
        htmlFor="statementDescriptor"
        hint={a.settings.statementDescriptorHint}
      >
        <Input
          id="statementDescriptor"
          name="statementDescriptor"
          maxLength={22}
          value={descriptor}
          onChange={(e) => setDescriptor(e.target.value)}
          placeholder={shop.name.slice(0, 22)}
        />
        {/*
          Three states, and the middle one is deliberately silent. A valid line
          is shown as the buyer will read it — monospaced, because the thing
          being checked is the characters. An empty field says what actually
          happens instead, which is not "nothing". A field that is non-empty and
          not yet valid says neither: somebody four characters into typing
          "SPECKLED" has not made a mistake, and telling them so is noise.
        */}
        {preview ? (
          <p className="mt-1.5 text-xs text-ink-500">
            {a.settings.statementDescriptorPreview}{" "}
            <span className="font-mono text-ink-900">{preview}</span>
          </p>
        ) : descriptor.trim() ? null : (
          <p className="mt-1.5 text-xs text-ink-500">
            {a.settings.statementDescriptorDefault}
          </p>
        )}
      </Field>

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
