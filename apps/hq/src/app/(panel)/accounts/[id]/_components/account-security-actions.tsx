import { LogOut } from "lucide-react";
import {
  ClearTwoFactor,
  RevokeAllSessions,
} from "@/app/_components/security-actions";
import { Card } from "@sailo/design-system/web";
import type { AccountSecurity } from "@/lib/platform";

/**
 * The two staff controls that are about the person rather than the shop.
 *
 * Kept out of `AccountActions` on purpose. That column is commercial — comp a
 * plan, take a shop down, leave a note — and this one is incident response.
 * Mixing them would put "sign out every device" one mis-click from "save note",
 * and the two have very different mornings after.
 */
export function AccountSecurityActions({
  userId,
  security,
  twoFactorEnabled,
}: {
  userId: string;
  security: AccountSecurity;
  twoFactorEnabled: boolean;
}) {
  const enrolled = twoFactorEnabled || Boolean(security.twoFactor);

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <LogOut className="size-4 text-ink-400" />
          <h3 className="text-sm font-semibold text-ink-900">
            Signed-in devices
          </h3>
        </div>
        {security.sessions.length === 0 ? (
          <p className="text-xs leading-relaxed text-ink-500">
            Nobody is signed in. Whoever had this account would have to sign in
            again, which is the state you are trying to reach anyway.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-ink-500">
              The first move on a compromised account: whoever is in there stays
              in until these rows are gone, and telling the owner to do it
              themselves assumes they can still sign in.
            </p>
            <RevokeAllSessions
              userId={userId}
              count={security.sessions.length}
            />
          </div>
        )}
      </Card>

      {enrolled ? (
        <ClearTwoFactor
          userId={userId}
          locked={security.twoFactor?.locked ?? false}
          failedAttempts={security.twoFactor?.failedVerificationCount ?? 0}
        />
      ) : null}
    </div>
  );
}
