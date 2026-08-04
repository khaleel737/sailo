import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");

  const { t } = await getT();

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        {t.auth.welcomeBack}
      </h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">{t.auth.signInSubtitle}</p>
      <AuthForm mode="login" t={t} />
    </>
  );
}
