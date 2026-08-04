import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Store } from "lucide-react";
import { getDb } from "@/db";
import { shops } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./onboarding-form";
import { LanguageSwitcher } from "@/components/shop/language-switcher";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Set up your shop" };

export default async function OnboardingPage() {
  const user = await requireUser();

  const existing = await getDb().query.shops.findFirst({
    where: eq(shops.userId, user.id),
    columns: { id: true },
  });
  if (existing) redirect("/admin");

  const { locale, t, dir } = await getT();

  return (
    <div
      dir={dir}
      lang={locale}
      className="flex min-h-screen flex-col items-center justify-center bg-ink-50 px-4 py-12"
    >
      <Link href="/" className="mb-8 inline-flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-xl bg-ink-900 text-white">
          <Store className="size-5" />
        </span>
        <span className="text-xl font-semibold tracking-tight">Sailo</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">
          {t.onboarding.claimTitle}
        </h1>
        <p className="mb-6 mt-1 text-sm text-ink-500">
          {t.onboarding.claimSubtitle}
        </p>
        <OnboardingForm defaultName={user.name} t={t} />
      </div>

      <div className="mt-6">
        <LanguageSwitcher current={locale} label={t.common.language} />
      </div>
    </div>
  );
}
