import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthHeader } from "@/components/auth/auth-kit";
import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Create your shop" };

export default async function SignupPage() {
  if (await getSession()) redirect("/admin");

  const { t } = await getT();

  return (
    <>
      <AuthHeader title={t.auth.createShop} subtitle={t.auth.signupSubtitle} />
      <AuthForm mode="signup" t={t} />
    </>
  );
}
