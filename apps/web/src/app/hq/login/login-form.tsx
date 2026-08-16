"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  AuthError,
  AuthField,
  AuthInput,
  AuthNotice,
  AuthSubmit,
} from "@/components/auth/auth-kit";

/**
 * Asks the server to mail a sign-in link, and says the same thing whatever
 * the address was. The server only mails the roster — but this form can't
 * know that, and an answer that varied would be a roster lookup for anyone
 * who cared to type addresses into it.
 */
export function HqLoginForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    setPending(true);

    const email = String(new FormData(event.currentTarget).get("email") ?? "")
      .trim();
    const result = await authClient.signIn.magicLink({
      email,
      callbackURL: "/hq",
    });

    setPending(false);
    if (result.error) setError(true);
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthNotice>
        Check your inbox. If that address has access, a sign-in link is on its
        way — it works once and expires in five minutes.
      </AuthNotice>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <AuthError>That didn&rsquo;t go through. Try again in a minute.</AuthError>
      ) : null}

      <AuthField label="Work email" htmlFor="email">
        <AuthInput
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@sailo.store"
        />
      </AuthField>

      <AuthSubmit loading={pending}>Email me a sign-in link</AuthSubmit>
    </form>
  );
}
