"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, Loader2, Plus } from "lucide-react";
import {
  saveAffiliate,
  updateAffiliateSettings,
} from "@/lib/actions/affiliates";
import { bpToPercent } from "@/lib/pricing";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import type { Affiliate, Shop } from "@/db/schema";

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
  const [state, action] = useActionState(updateAffiliateSettings, { ok: false });
  const [enabled, setEnabled] = useState(shop.affiliatesEnabled);

  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="affiliatesEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900"
          />
          <span>
            <span className="block text-sm font-medium">
              Run a referral programme
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
              label="Default commission"
              htmlFor="defaultCommission"
              hint="% of each order, before delivery"
            >
              <Input
                id="defaultCommission"
                name="defaultCommission"
                inputMode="decimal"
                defaultValue={String(bpToPercent(shop.affiliateDefaultBp))}
                placeholder="10"
              />
            </Field>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                name="affiliatePublicSignup"
                defaultChecked={shop.affiliatePublicSignup}
                className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900"
              />
              <span>
                <span className="block text-sm font-medium">
                  Let anyone apply
                </span>
                <span className="block text-xs text-ink-500">
                  Adds a signup form to your public referral page. Applications
                  wait for your approval.
                </span>
              </span>
            </label>

            <Field label="Programme terms" htmlFor="affiliateTerms" hint="optional">
              <Textarea
                id="affiliateTerms"
                name="affiliateTerms"
                rows={3}
                defaultValue={shop.affiliateTerms ?? ""}
                placeholder="Commission is paid monthly by bank transfer once you reach $50."
              />
            </Field>
          </>
        ) : null}

        <Submit label="Save settings" />
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
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              defaultValue={affiliate?.name ?? ""}
              placeholder="Amara Okafor"
            />
          </Field>
          <Field label="Email" htmlFor="email" hint="optional">
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={affiliate?.email ?? ""}
              placeholder="amara@example.com"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" htmlFor="code" hint="auto if blank">
            <Input
              id="code"
              name="code"
              defaultValue={affiliate?.code ?? ""}
              placeholder="AMARA"
              className="uppercase"
            />
          </Field>
          <Field
            label="Commission %"
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
          <Field label="Status" htmlFor="status">
            <Select
              id="status"
              name="status"
              defaultValue={affiliate?.status ?? "active"}
            >
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="disabled">Disabled</option>
            </Select>
          </Field>
        </div>

        <Field label="Payout notes" htmlFor="payoutNotes" hint="private">
          <Input
            id="payoutNotes"
            name="payoutNotes"
            defaultValue={affiliate?.payoutNotes ?? ""}
            placeholder="Pays out to GTB 0123456789"
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
        className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-600 transition hover:text-ink-900"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
