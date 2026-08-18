import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card } from "@sailo/design-system/web";
import { AccountSecurityActions } from "../_components/account-security-actions";
import { SecurityPanel } from "../_components/security-panel";
import { getAccountHeader, getAccountSecurityTab } from "@/lib/platform";
import { staffCan } from "@/lib/session";

export const metadata: Metadata = { title: "Security" };

/**
 * What guards this account, and the two things we can do about it.
 *
 * The only tab that renders for an account with no shop. Somebody who signed up
 * and never onboarded can still be signed in from three countries and still be
 * locked out of their authenticator, and they are still the person on the other
 * end of a support mail about either.
 *
 * The actions sit behind two different capabilities and are gated separately —
 * see `account-security-actions`. Revoking makes an account less reachable and
 * support holds it; clearing a second factor makes it more reachable and they
 * do not.
 */
export default async function HqAccountSecurityPage({
  params,
}: PageProps<"/accounts/[id]/security">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header) notFound();

  const { owner, shop } = header;

  const [security, maySecure, mayRecover] = await Promise.all([
    getAccountSecurityTab(owner.id, shop?.id ?? null),
    staffCan("account:secure"),
    staffCan("account:recover"),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <SecurityPanel
          security={security}
          emailVerified={owner.emailVerified}
          twoFactorEnabled={owner.twoFactorEnabled}
          mayRevoke={maySecure}
        />
      </div>

      <aside className="min-w-0 space-y-3">
        {maySecure || mayRecover ? (
          <AccountSecurityActions
            userId={owner.id}
            security={security}
            twoFactorEnabled={owner.twoFactorEnabled}
            may={{ secure: maySecure, recover: mayRecover }}
          />
        ) : (
          <Card className="p-4">
            <p className="text-xs leading-relaxed text-ink-500">
              You can see what guards this account and not change it. Signing a
              compromised account out needs a role you don&rsquo;t hold.
            </p>
          </Card>
        )}
      </aside>
    </div>
  );
}
