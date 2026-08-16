"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  AuthError,
  AuthField,
  AuthInput,
  AuthSubmit,
} from "@/components/auth/auth-kit";
import type { Dictionary } from "@sailo/i18n";

/**
 * The second factor, spent.
 *
 * Two ways in, one form: the rotating code from an authenticator app, or one
 * of the backup codes saved at enrolment. Whichever succeeds creates the
 * session the password alone no longer does.
 *
 * The refusal is always the server's own message. A code that is wrong, a
 * code that is late, and a caller who has been throttled are three different
 * things, and flattening them into "invalid code" would tell someone being
 * rate-limited that their correct code was wrong — the repo's rule is that a
 * throttled attempt is *unknown*, never *wrong*.
 */
export function VerifyTwoFactorForm({ t }: { t: Dictionary }) {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();

    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });

    if (result.error) {
      /*
       * A missing or expired challenge cookie means the ten-minute window
       * closed — there is nothing left on this page to retry, so say so and
       * point back at sign-in rather than letting them type into a form that
       * can no longer succeed.
       */
      setError(
        result.error.code === "INVALID_TWO_FACTOR_COOKIE"
          ? t.auth.twoFactorExpired
          : (result.error.message ?? t.auth.somethingWrong),
      );
      setPending(false);
      return;
    }

    router.push("/onboarding");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {error ? <AuthError>{error}</AuthError> : null}

      <AuthField
        label={useBackup ? t.auth.twoFactorBackupCode : t.auth.twoFactorCode}
        htmlFor="code"
        hint={useBackup ? t.auth.twoFactorBackupSubtitle : undefined}
      >
        <AuthInput
          // Remounts when the mode flips, so the old code is not left sitting
          // in a field now labelled as the other kind.
          key={useBackup ? "backup" : "totp"}
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={useBackup ? "text" : "numeric"}
          placeholder={useBackup ? "XXXXX-XXXXX" : "123456"}
        />
      </AuthField>

      <AuthSubmit loading={pending}>{t.auth.twoFactorVerify}</AuthSubmit>

      <p className="text-center">
        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v);
            setError(null);
          }}
          className="focus-line draw-underline inline-flex items-center text-[0.8125rem] text-[var(--mute-500)] pointer-coarse:min-h-11"
        >
          {useBackup ? t.auth.twoFactorUseApp : t.auth.twoFactorUseBackup}
        </button>
      </p>
    </form>
  );
}
