import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthHeader } from "@/components/auth/auth-kit";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");

  const { t } = await getT();

  return (
    <>
      <AuthHeader title={t.auth.welcomeBack} subtitle={t.auth.signInSubtitle} />
      <AuthForm mode="login" t={t} />
    </>
  );
}
