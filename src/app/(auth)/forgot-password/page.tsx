import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";
import { AuthHeader } from "@/components/auth/auth-kit";
import { ForgotPasswordForm } from "./forgot-password-form";

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
