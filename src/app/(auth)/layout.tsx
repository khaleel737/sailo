import Link from "next/link";
import { Store } from "lucide-react";
import { LanguageSwitcher } from "@/components/shop/language-switcher";
import { getT } from "@/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
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
      <div className="w-full max-w-sm rounded-2xl border border-ink-200 bg-white p-6 shadow-sm sm:p-8">
        {children}
      </div>
      <div className="mt-6">
        <LanguageSwitcher current={locale} label={t.common.language} />
      </div>
    </div>
  );
}
