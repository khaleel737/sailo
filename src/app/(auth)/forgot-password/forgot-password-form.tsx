"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { Dictionary } from "@/i18n";

/**
 * Asks for a reset link.
 *
 * The confirmation is the same whether or not the address has an account, and
 * it's shown even when the request errors: a form that answered honestly would
 * be a way to test which addresses sell on Sailo. Better-auth already returns
 * a uniform response and pads the timing on its side; this keeps the UI from
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
      <div className="space-y-4">
        <Alert tone="success">{t.auth.resetSent}</Alert>
        <Link
          href="/login"
          className="focus-ring block rounded text-center text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
        >
          {t.auth.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t.auth.email} htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
      </Field>

      <Button
        type="submit"
        variant="brand"
        size="lg"
        className="w-full"
        loading={pending}
      >
        {t.auth.sendResetLink}
      </Button>

      <p className="text-center text-sm text-ink-500">
        <Link
          href="/login"
          className="focus-ring rounded font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
        >
          {t.auth.backToSignIn}
        </Link>
      </p>
    </form>
  );
}
