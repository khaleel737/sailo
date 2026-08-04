import { SettingsNav } from "@/components/admin/settings-nav";

export default function SettingsLayout({
  children,
}: LayoutProps<"/admin/settings">) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your shop details, plan and data.
        </p>
      </div>
      <SettingsNav />
      {children}
    </>
  );
}
