"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { requestPortalLink } from "@/lib/actions/partner";

export function PartnerSignIn({
  emailLabel,
  action,
  done,
}: {
  emailLabel: string;
  action: string;
  done: string;
}) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    await requestPortalLink(email);
    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <p className="surface-card flex items-start gap-2.5 rounded-2xl p-4 text-sm leading-relaxed">
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        {done}
      </p>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-2.5">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={emailLabel}
        aria-label={emailLabel}
        autoComplete="email"
        className="surface-card h-11 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
      />
      <button
        type="submit"
        disabled={pending || !email.trim()}
        className="accent-bg flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {action}
      </button>
    </form>
  );
}
