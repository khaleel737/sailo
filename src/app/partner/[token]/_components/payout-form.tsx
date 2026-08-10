"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { savePayoutDetails } from "@/lib/actions/partner";
import { PAYOUT_METHOD_TYPES, type PayoutMethodType } from "@/lib/payouts";
import { interpolate, type Dictionary } from "@/i18n";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

/**
 * Where the money should go, told to the seller by the affiliate themselves.
 *
 * The details input starts empty even when something is on file: what's saved
 * is shown masked above the form (the page renders that), and this form only
 * ever *replaces*. Echoing the full saved value back into an input would
 * quietly undo the masking for anyone who opens the page with a leaked link.
 */
export function PayoutForm({
  token,
  method,
  shopName,
  t,
}: {
  token: string;
  /** What's currently on file, so the select opens on it. */
  method: string | null;
  shopName: string;
  t: Dictionary;
}) {
  const [state, action] = useActionState(savePayoutDetails, { ok: false });
  const [chosen, setChosen] = useState<PayoutMethodType>(
    method === "paypal" || method === "other" ? method : "bank",
  );

  const methodLabel: Record<PayoutMethodType, string> = {
    bank: t.partner.payoutBank,
    paypal: t.partner.payoutPaypal,
    other: t.partner.payoutOther,
  };
  const placeholder: Record<PayoutMethodType, string> = {
    bank: t.partner.payoutBankHint,
    paypal: t.partner.payoutPaypalHint,
    other: interpolate(t.partner.payoutOtherHint, { shop: shopName }),
  };

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {interpolate(t.partner.payoutSaved, { shop: shopName })}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
        <label className="block">
          <span className="text-muted mb-1 block text-xs font-medium">
            {t.partner.payoutMethodLabel}
          </span>
          <select
            name="method"
            value={chosen}
            onChange={(event) =>
              setChosen(event.target.value as PayoutMethodType)
            }
            className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none"
          >
            {PAYOUT_METHOD_TYPES.map((type) => (
              <option key={type} value={type}>
                {methodLabel[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-muted mb-1 block text-xs font-medium">
            {t.partner.payoutDetailsLabel}
          </span>
          <input
            name="details"
            required
            maxLength={300}
            placeholder={placeholder[chosen]}
            // Payment details on a page opened by a link: nothing here should
            // land in a shared machine's autofill.
            autoComplete="off"
            dir="auto"
            className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
          />
        </label>
      </div>

      <Submit label={t.partner.payoutSave} />
    </form>
  );
}
