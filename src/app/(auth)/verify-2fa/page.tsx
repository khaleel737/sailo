import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeader } from "@/components/auth/auth-kit";
import { VerifyTwoFactorForm } from "@/components/verify-two-factor-form";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";

/*
 * Reads the session, so it blocks rather than prerenders — and `instant`
 * marks a segment rather than inheriting, so saying it in the layout is not
 * enough. Same note as `login/page.tsx`.
 */
export const instant = false;

export const metadata: Metadata = { title: "Two-factor verification" };

/**
 * Where a password sign-in lands when the account has two-factor on.
 *
 * There is deliberately no session here yet: better-auth deleted the one the
 * password created and left a short-lived signed challenge cookie in its
 * place. That cookie is the only thing tying this page to an account, which
 * is why the form posts a code and nothing else — no email, no user id, no
 * way for this URL to be used against an account the caller hasn't already
 * proven a password for.
 */
export default async function VerifyTwoFactorPage() {
  // Already through: either they never needed this step, or they finished it
  // and came back to the URL.
  if (await getSession()) redirect("/admin");

  const { t } = await getT();

  return (
    <>
      <AuthHeader title={t.auth.twoFactorTitle} subtitle={t.auth.twoFactorSubtitle} />
      <VerifyTwoFactorForm t={t} />
    </>
  );
}
