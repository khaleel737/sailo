import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getPartnerForUser } from "@/lib/partners/applications";
import { syncPartnerAccount } from "@/lib/partners/connect";

export const instant = false;

/**
 * Where Stripe sends the partner back to.
 *
 * Both of Stripe's callbacks land here — `return` when they finish the form
 * and `refresh` when the single-use link expired before they did. Neither is a
 * page anyone should sit on, so this syncs and redirects; the partner's own
 * page then renders whichever state is now actually true.
 *
 * The sync is the point. Finishing onboarding is not the same as being
 * payable — Stripe may still be verifying — so this re-reads the account
 * rather than assuming the return means success. Without it, a partner who
 * completed the form would keep seeing "connect your account" until something
 * else happened to refresh their row.
 */
export default async function PartnerConnectReturn() {
  const session = await getSession();
  if (!session?.user) redirect("/login?next=/partners");

  const partner = await getPartnerForUser(session.user.id);
  /*
   * Failure is silent on purpose. Stripe being unreachable for one round trip
   * should not be an error page at the end of a successful onboarding — the
   * row is re-synced on the next visit, and the partner sees a stale banner in
   * the meantime rather than a dead end.
   */
  if (partner) {
    try {
      await syncPartnerAccount(partner);
    } catch (error) {
      console.error("[sailo] could not sync a partner account:", error);
    }
  }

  redirect("/partners");
}
