import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";
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
      <h1 className="text-xl font-semibold tracking-tight">
        {t.auth.forgotTitle}
      </h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">{t.auth.forgotSubtitle}</p>
      <ForgotPasswordForm t={t} />
    </>
  );
}
