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
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? t.auth.somethingWrong);
      setPending(false);
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
