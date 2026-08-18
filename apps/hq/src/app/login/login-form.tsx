"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@sailo/design-system/web";

/*
 * The design system's plain controls, not apps/web's `auth-kit`.
 *
 * That kit is written against `--ink` and `--mute-*`, which are declared inside
 * `.brand-surface` in apps/web's marketing stylesheet — so it only renders
 * correctly with that class as an ancestor. It belongs where those variables
 * are, and this panel does not carry them: HQ is the ink ramp, like every other
 * screen here. One email field and a button need no kit anyway.
 */

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
      callbackURL: "/",
    });

    setPending(false);
    if (result.error) setError(true);
    else setSent(true);
  }

  if (sent) {
    return (
      <Alert tone="success">
        Check your inbox. If that address has access, a sign-in link is on its
        way — it works once and expires in five minutes.
      </Alert>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-5">
      {error ? (
        <Alert tone="error">
          That didn&rsquo;t go through. Try again in a minute.
        </Alert>
      ) : null}

      <Field label="Work email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@sailo.store"
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
