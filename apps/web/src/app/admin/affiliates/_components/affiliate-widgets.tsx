"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import {
  saveAffiliate,
  updateAffiliateSettings,
} from "@/lib/actions/affiliates";
import { bpToPercent } from "@sailo/core/pricing";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@sailo/design-system/web";
import type { Affiliate, Shop } from "@sailo/db/schema";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function AffiliateSettingsForm({ shop }: { shop: Shop }) {
  const a = useAdminT();
  const [state, action] = useActionState(updateAffiliateSettings, { ok: false });
  const [enabled, setEnabled] = useState(shop.affiliatesEnabled);

  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="affiliatesEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">
              {a.affiliates.runProgramme}
            </span>
            <span className="block text-xs text-ink-500">
              Adds a referral link to your shop footer and offers buyers their
              own link after they order.
            </span>
          </span>
        </label>

        {enabled ? (
          <>
            <Field
              label={a.affiliates.defaultCommission}
              htmlFor="defaultCommission"
              hint={a.affiliates.commissionHint}
            >
              <Input
                id="defaultCommission"
                name="defaultCommission"
                inputMode="decimal"
                defaultValue={String(bpToPercent(shop.affiliateDefaultBp))}
                placeholder="10"
              />
            </Field>

            <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
              <input
                type="checkbox"
                name="affiliatePublicSignup"
                defaultChecked={shop.affiliatePublicSignup}
                className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
              />
              <span>
                <span className="block text-sm font-medium">
                  {a.affiliates.letAnyoneApply}
                </span>
                <span className="block text-xs text-ink-500">
                  Adds a signup form to your public referral page. Applications
                  wait for your approval.
                </span>
              </span>
            </label>

            <Field label={a.affiliates.terms} htmlFor="affiliateTerms" hint={a.common.optional}>
              <Textarea
                id="affiliateTerms"
                name="affiliateTerms"
                rows={3}
                defaultValue={shop.affiliateTerms ?? ""}
                placeholder={a.affiliates.termsPlaceholder}
              />
            </Field>
          </>
        ) : null}

        <Submit label={a.affiliates.saveSettings} />
      </form>
    </Card>
  );
}

export function AffiliateForm({
  affiliate,
  defaultBp,
}: {
  affiliate?: Affiliate;
  defaultBp: number;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(saveAffiliate, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !affiliate) formRef.current?.reset();
  }, [state, affiliate]);

  return (
    <Card className="p-5">
      <form ref={formRef} action={action} className="space-y-4">
        {affiliate ? (
          <input type="hidden" name="id" value={affiliate.id} />
        ) : null}

        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={a.common.name} htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              defaultValue={affiliate?.name ?? ""}
              placeholder={a.affiliates.namePlaceholder}
            />
          </Field>
          <Field label={a.common.email} htmlFor="email" hint={a.common.optional}>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={affiliate?.email ?? ""}
              placeholder={a.affiliates.emailPlaceholder}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={a.common.code} htmlFor="code" hint={a.affiliates.codeHint}>
            <Input
              id="code"
              name="code"
              defaultValue={affiliate?.code ?? ""}
              placeholder={a.affiliates.codePlaceholder}
              className="uppercase"
            />
          </Field>
          <Field
            label={a.affiliates.commissionPercent}
            htmlFor="commission"
            hint={`default ${bpToPercent(defaultBp)}%`}
          >
            <Input
              id="commission"
              name="commission"
              inputMode="decimal"
              defaultValue={
                affiliate?.commissionBp !== null &&
                affiliate?.commissionBp !== undefined
                  ? String(bpToPercent(affiliate.commissionBp))
                  : ""
              }
              placeholder={String(bpToPercent(defaultBp))}
            />
          </Field>
          <Field label={a.common.status} htmlFor="status">
            <Select
              id="status"
              name="status"
              defaultValue={affiliate?.status ?? "active"}
            >
              <option value="active">{a.affiliates.statusActive}</option>
              <option value="pending">{a.affiliates.statusPending}</option>
              <option value="disabled">{a.affiliates.statusDisabled}</option>
            </Select>
          </Field>
        </div>

        <Field label={a.affiliates.payoutNotes} htmlFor="payoutNotes" hint={a.common.private}>
          <Input
            id="payoutNotes"
            name="payoutNotes"
            defaultValue={affiliate?.payoutNotes ?? ""}
            placeholder={a.affiliates.payoutPlaceholder}
          />
        </Field>

        <Button type="submit">
          {affiliate ? null : <Plus className="size-4" />}
          {affiliate ? "Save" : "Add affiliate"}
        </Button>
      </form>
    </Card>
  );
}

export function AffiliateLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The URL is rendered next to the button, so copying is a convenience.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate text-xs text-ink-600">{url}</code>
      <button
        type="button"
        onClick={copy}
        className="focus-ring inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-ink-600 transition hover:text-ink-900 pointer-coarse:min-h-11"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
