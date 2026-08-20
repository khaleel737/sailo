import { requireUser, shopForUser } from "@/lib/session";
import { SettingsShell } from "./_components/settings-shell";

/*
 * Settings render inside a full-screen overlay with their own rail — see
 * `settings-shell.tsx` for why the modal is earned here. This layout stays a
 * server component so every settings page keeps streaming through it; the
 * shell is the client boundary.
 *
 * Identity for the rail's two chips is read with the session helpers, not
 * `requireShop`: the chips display who and where, they gate nothing — every
 * page inside still claims its own permission, and the audit in
 * `session.test.ts` keeps counting real claims only.
 */
export default async function SettingsLayout({
  children,
}: LayoutProps<"/admin/settings">) {
  const user = await requireUser();
  const found = await shopForUser(user.id);

  return (
    <SettingsShell
      shopName={found?.shop.name ?? ""}
      handle={found?.shop.handle ?? ""}
      userName={user.name ?? user.email}
      userEmail={user.email}
    >
      {children}
    </SettingsShell>
  );
}
