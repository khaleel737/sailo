import type { Metadata } from "next";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can } from "@sailo/core/plans";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import { readTeam } from "@/lib/actions/team";
import { TeamCard } from "./_components/team-card";
import { ActivityCard } from "./_components/activity-card";

export const metadata: Metadata = { title: "Team" };
export const instant = false;

/**
 * Spec 37's screen.
 *
 * `team:read` rather than `team:write`, so a future role that may *see* the
 * team without changing it needs no second guard — today that is only the
 * owner either way, because neither manager nor staff carries `team` at all.
 */
export default async function TeamSettingsPage() {
  const { shop, user } = await requireShop("team:read");
  const { a } = await getAdminT();

  if (!can(shop, "teams")) {
    const { t } = await getT();
    return (
      <LockedFeature
        shop={shop}
        feature="teams"
        title={a.settings.teamTitle}
        description={a.settings.teamBody}
        t={t}
      />
    );
  }

  const { members, invitations, actions } = await readTeam(
    shop.id,
    shop.organizationId,
  );

  return (
    <div className="space-y-5">
      <TeamCard
        members={members}
        invitations={invitations}
        ownerUserId={shop.userId}
        youUserId={user.id}
      />
      <ActivityCard actions={actions} />
    </div>
  );
}
