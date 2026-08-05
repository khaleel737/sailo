"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui";
import type { Dictionary } from "@/i18n";

/**
 * Sets the new password.
 *
 * Resetting deliberately doesn't sign anyone in: it ends every existing
 * session, including any the person who prompted the reset was holding, so the
 * next step is a fresh sign-in with the password just chosen.
 */
export function ResetPasswordForm({
  token,
  t,
}: {
  token: string;
  t: Dictionary;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");

    // Caught here rather than after the round trip, because a mismatch spends
    // the token and the next attempt would land on a dead link.
    if (newPassword !== confirm) {
      setError(t.auth.passwordsDiffer);
      return;
    }

    setPending(true);
    const result = await authClient.resetPassword({ newPassword, token });

    if (result.error) {
      setError(
        result.error.code === "INVALID_TOKEN"
          ? t.auth.resetInvalid
          : (result.error.message ?? t.auth.somethingWrong),
      );
      setPending(false);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{t.auth.resetDone}</Alert>
        <Link
          href="/login"
          className="focus-ring accent-bg press flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold"
        >
          {t.auth.signIn}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      <Field label={t.auth.newPassword} htmlFor="password" hint={t.auth.minChars}>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </Field>

      <Field label={t.auth.confirmPassword} htmlFor="confirm">
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </Field>

      <Button
        type="submit"
        variant="brand"
        size="lg"
        className="w-full"
        loading={pending}
      >
        {t.auth.updatePassword}
      </Button>
    </form>
  );
}
