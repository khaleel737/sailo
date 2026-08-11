import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shops } from "@sailo/db/schema";
import { requireUser } from "@/lib/session";
import { OnboardingForm } from "./_components/onboarding-form";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { SailoLogo } from "@/components/brand";
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
    <div dir={dir} lang={locale} className="relative min-h-screen bg-ink-50">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-8 sm:py-12">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="focus-ring rounded-lg text-brand-700">
            <SailoLogo className="h-6 w-auto" />
          </Link>
          <LanguageSwitcher current={locale} label={t.common.language} />
        </header>

        <main className="flex-1 rounded-3xl border border-ink-200 bg-white p-6 shadow-md sm:p-8 lg:p-10">
          <OnboardingForm defaultName={user.name} t={t} locale={locale} />
        </main>
      </div>
    </div>
  );
}
