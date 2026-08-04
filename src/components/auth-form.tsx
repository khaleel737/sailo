"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
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
      setError(result.error.message ?? "Something went wrong. Try again.");
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
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" required autoComplete="name" placeholder="Amina Yusuf" />
        </Field>
      ) : null}

      <Field label="Email" htmlFor="email">
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
        label="Password"
        htmlFor="password"
        hint={isSignup ? "8 characters minimum" : undefined}
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

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {isSignup ? "Create my shop" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-ink-500">
        {isSignup ? "Already have a shop? " : "New to Sailo? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-ink-900 underline underline-offset-4"
        >
          {isSignup ? "Sign in" : "Create one free"}
        </Link>
      </p>
    </form>
  );
}
