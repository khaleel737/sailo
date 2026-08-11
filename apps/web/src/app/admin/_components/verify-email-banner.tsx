"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/**
 * The nudge that sits in the admin until the seller clicks the confirmation
 * link sign-up sent them. Client-side only because of the resend button; the
 * decision to show it at all is the server's, in StatusBanners.
 *
 * Strings arrive as props: this is a client component, and the dictionaries
 * stay on the server.
 */
export function VerifyEmailBanner({
  email,
  labels,
}: {
  email: string;
  labels: { title: string; body: string; cta: string; sent: string };
}) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function resend() {
    setPending(true);
    await authClient.sendVerificationEmail({ email, callbackURL: "/admin" });
    // Told as sent either way — the server decides what actually goes out,
    // and "try again" is the honest advice for every failure it could have.
    setPending(false);
    setSent(true);
  }

  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <MailCheck className="size-4 shrink-0 text-amber-700" />
        <p dir="auto" className="flex-1 text-sm text-amber-900">
          <span className="font-medium">{labels.title}</span>{" "}
          {sent ? labels.sent : labels.body}
        </p>
        {sent ? null : (
          <button
            type="button"
            onClick={resend}
            disabled={pending}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg bg-amber-900 px-3 text-xs font-semibold text-white transition hover:bg-amber-800 disabled:pointer-events-none disabled:opacity-55 pointer-coarse:min-h-11 min-h-9"
          >
            {labels.cta}
          </button>
        )}
      </div>
    </div>
  );
}
