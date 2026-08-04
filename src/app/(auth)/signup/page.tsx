import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Create your shop" };

export default async function SignupPage() {
  if (await getSession()) redirect("/admin");

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">
        Create your shop
      </h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">
        Free, and live in under a minute.
      </p>
      <AuthForm mode="signup" />
    </>
  );
}
