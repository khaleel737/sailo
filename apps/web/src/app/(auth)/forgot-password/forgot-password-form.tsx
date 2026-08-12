"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  AuthField,
  AuthFooterLink,
  AuthInput,
  AuthNotice,
  AuthSubmit,
} from "@/components/auth/auth-kit";
import type { Dictionary } from "@sailo/i18n";

/**
 * Asks for a reset link.
 *
 * The confirmation is the same whether or not the address has an account, and
 * it is shown even when the request errors: a form that answered honestly would
 * be a way to test which addresses sell on Sailo. Better-auth already returns a
 * uniform response and pads the timing on its side; this keeps the UI from
 * giving away what the API deliberately withholds.
 */
export function ForgotPasswordForm({ t }: { t: Dictionary }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();

    await authClient.requestPasswordReset({
      email,
      // Where the link lands once better-auth has checked the token.
      redirectTo: "/reset-password",
    });

    setPending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <AuthNotice>{t.auth.resetSent}</AuthNotice>
        <AuthFooterLink href="/login" label={t.auth.backToSignIn} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <AuthField label={t.auth.email} htmlFor="email">
        <AuthInput
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
        />
      </AuthField>

      <AuthSubmit loading={pending}>{t.auth.sendResetLink}</AuthSubmit>

      <AuthFooterLink href="/login" label={t.auth.backToSignIn} />
    </form>
  );
}
