import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireShop } from "@/lib/session";
import { getSession } from "@/lib/session";
import { listLoginSessions } from "@/lib/queries/sessions";
import { openObligations } from "@/lib/account-deletion";
import { TwoFactorCard } from "./_components/two-factor-card";
import { SessionsCard } from "./_components/sessions-card";
import { DeleteAccountCard } from "./_components/delete-account-card";

export const metadata: Metadata = { title: "Security" };

/*
 * Reads the session on every render and must not be prerendered — the whole
 * page is "what is true about this account right now".
 */
export const instant = false;

export default async function SecuritySettingsPage() {
  const { user, shop } = await requireShop();
  const session = await getSession();
  // `requireShop` already redirected if there were no session; this narrows
  // the type and covers the sliver where it expired mid-render.
  if (!session) redirect("/login");

  const [sessions, obligations] = await Promise.all([
    listLoginSessions(user.id, session.session.token),
    openObligations(shop.id),
  ]);

  return (
    <div className="space-y-6">
      <TwoFactorCard enabled={Boolean(user.twoFactorEnabled)} />
      <SessionsCard sessions={sessions} />
      <DeleteAccountCard handle={shop.handle} blocked={obligations.blocked} />
    </div>
  );
}
