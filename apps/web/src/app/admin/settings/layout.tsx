import { SettingsShell } from "./_components/settings-shell";

/*
 * Settings render inside a full-screen overlay with their own rail — see
 * `settings-shell.tsx` for why the modal is earned here. This layout stays
 * a server component so every settings page keeps streaming through it;
 * the shell is the client boundary.
 */
export default function SettingsLayout({
  children,
}: LayoutProps<"/admin/settings">) {
  return <SettingsShell>{children}</SettingsShell>;
}
