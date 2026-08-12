"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { applyAsAffiliate } from "@/lib/actions/affiliates";
import type { Dictionary } from "@sailo/i18n";

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

export function AffiliateSignupForm({
  shopId,
  t,
}: {
  shopId: string;
  t: Dictionary;
}) {
  const [state, action] = useActionState(applyAsAffiliate, { ok: false });

  if (state.ok) {
    return (
      <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
        {t.affiliate.applyThanks}
      </p>
    );
  }

  return (
    <form action={action} className="surface-card space-y-3 rounded-2xl p-4">
      <input type="hidden" name="shopId" value={shopId} />

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <input
        name="name"
        required
        placeholder={t.affiliate.yourName}
        autoComplete="name"
        className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
      />
      <input
        name="email"
        type="email"
        required
        placeholder={t.affiliate.yourEmail}
        autoComplete="email"
        className="surface-elevated h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
      />
      <Submit label={t.affiliate.applyButton} />
    </form>
  );
}
