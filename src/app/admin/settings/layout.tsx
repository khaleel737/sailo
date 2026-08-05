import { SettingsNav } from "@/app/admin/settings/_components/settings-nav";
import { getAdminT } from "@/i18n/server";

export default async function SettingsLayout({
  children,
}: LayoutProps<"/admin/settings">) {
  const { a } = await getAdminT();

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {a.settings.title}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{a.settings.description}</p>
      </div>
      <SettingsNav />
      {children}
    </>
  );
}
