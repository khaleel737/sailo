"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui";
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
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert>{error}</Alert> : null}

      {isSignup ? (
        <Field label={t.auth.yourName} htmlFor="name">
          <Input id="name" name="name" required autoComplete="name" placeholder="Amina Yusuf" />
        </Field>
      ) : null}

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

      <Field
        label={t.auth.password}
        htmlFor="password"
        hint={isSignup ? t.auth.minChars : undefined}
      >
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={isSignup ? "new-password" : "current-password"}
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
        {isSignup ? t.auth.createMyShop : t.auth.signIn}
      </Button>

      <p className="text-center text-sm text-ink-500">
        {isSignup ? `${t.auth.haveShop} ` : `${t.auth.newHere} `}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="focus-ring rounded font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800"
        >
          {isSignup ? t.auth.signIn : t.auth.createOne}
        </Link>
      </p>
    </form>
  );
}
