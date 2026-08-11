import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";
import { AuthHeader } from "@/components/auth/auth-kit";
import { ForgotPasswordForm } from "./forgot-password-form";

/*
 * Not yet converted, for the same reason as the layout around it: this reads
 * the session to send an already-signed-in seller to their admin, which is a
 * per-visitor answer. `instant = false` marks a *segment* as allowed to block
 * and does not inherit, so the layout declaring it is not enough — the page
 * has to say so too, which is what the dev-time prerender error was reporting.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  // Someone already signed in doesn't need the link — they can change it in
  // settings, and landing here usually means a stale tab.
  if (await getSession()) redirect("/admin");

  const { t } = await getT();

  return (
    <>
      <AuthHeader title={t.auth.forgotTitle} subtitle={t.auth.forgotSubtitle} />
      <ForgotPasswordForm t={t} />
    </>
  );
}
