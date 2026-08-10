"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import {
  AuthError,
  AuthField,
  AuthFooterLink,
  AuthInput,
  AuthSubmit,
} from "@/components/auth/auth-kit";
import type { Dictionary } from "@/i18n";

export function AuthForm({
  mode,
  t,
}: {
  mode: "login" | "signup";
  t: Dictionary;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const name = String(data.get("name") ?? "").trim();

    const result = isSignup
      ? // callbackURL is where the emailed confirmation link lands, not this
        // form's redirect — that stays the router.push below.
        await authClient.signUp.email({ email, password, name, callbackURL: "/admin" })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? t.auth.somethingWrong);
      setPending(false);
      return;
    }

    /*
     * A password is only half a sign-in for anyone with two-factor on.
     *
     * Better-auth answers `twoFactorRedirect` instead of a session: the
     * credential was right, but the session it would have created has been
     * deleted again and a short-lived challenge cookie put in its place. So
     * there is nothing signed in yet, and /verify-2fa is where the second
     * factor is spent. Sign-up can never see this — a brand-new account has
     * no second factor — but the branch is on both paths because the check
     * is on the response, not on the mode.
     *
     * Guarded on the shape rather than written as `"x" in result.data`: `in`
     * throws on null, and a success whose body is null is a shape the client
     * types permit. That throw would surface as a sign-in that spins forever,
     * which is a worse failure than the one this branch exists to handle.
     */
    const payload = result.data as { twoFactorRedirect?: boolean } | null;
    if (payload?.twoFactorRedirect) {
      router.push("/verify-2fa");
      return;
    }

    // Onboarding decides whether they need a shop or already have one.
    router.push("/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error ? <AuthError>{error}</AuthError> : null}

      {isSignup ? (
        <AuthField label={t.auth.yourName} htmlFor="name">
          <AuthInput
            id="name"
            name="name"
            required
            autoComplete="name"
            placeholder="Amina Yusuf"
          />
        </AuthField>
      ) : null}

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

      <AuthField
        label={t.auth.password}
        htmlFor="password"
        hint={isSignup ? t.auth.minChars : undefined}
        // Sits beside the field it is about, so it is found at the moment the
        // password will not come rather than after the sign-in fails.
        action={
          isSignup ? undefined : (
            <Link
              href="/forgot-password"
              className="focus-line draw-underline inline-flex items-center text-[0.8125rem] text-[var(--mute-500)] pointer-coarse:min-h-11"
            >
              {t.auth.forgotPassword}
            </Link>
          )
        }
      >
        <AuthInput
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder="••••••••"
        />
      </AuthField>

      <AuthSubmit loading={pending}>
        {isSignup ? t.auth.createMyShop : t.auth.signIn}
      </AuthSubmit>

      <AuthFooterLink
        prompt={isSignup ? t.auth.haveShop : t.auth.newHere}
        href={isSignup ? "/login" : "/signup"}
        label={isSignup ? t.auth.signIn : t.auth.createOne}
      />
    </form>
  );
}
