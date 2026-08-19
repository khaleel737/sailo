"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { invitation, member, session, shopMemberActions, user } from "@sailo/db/schema";
import { auth } from "@/lib/auth";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { can, cheapestPlanWith } from "@sailo/core/plans";
import { isShopRole, type ShopRole } from "@sailo/auth/permissions";
import type { ActionState } from "@sailo/core/action-state";

/**
 * The team screen's writes — spec 37.
 *
 * Every one of them goes through `requireShop("team:write")`, which is owner-
 * only by construction: `team` is the resource the manager and staff roles do
 * not carry at all.
 */

/**
 * Who did what, appended.
 *
 * Called from the actions themselves rather than from inside `requireShop`,
 * because a guard that logged every *read* would fill the table with page
 * views and bury the one line somebody is looking for. Best-effort: a logging
 * failure must never undo the thing it was recording.
 */
export async function recordMemberAction(opts: {
  shopId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  subjectType?: string;
  subjectId?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getDb().insert(shopMemberActions).values({
      shopId: opts.shopId,
      actorEmail: opts.actorEmail.toLowerCase(),
      actorRole: opts.actorRole,
      action: opts.action,
      subjectType: opts.subjectType ?? null,
      subjectId: opts.subjectId ?? null,
      detail: opts.detail ?? null,
    });
  } catch (error) {
    console.error("[sailo] could not record a team action", error);
  }
}

export async function inviteTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { shop, user: actor, role } = await requireShop("team:write");

  if (!can(shop, "teams")) {
    const plan = cheapestPlanWith("teams");
    return { ok: false, error: `Team members are on ${plan?.name ?? "a paid plan"}.` };
  }
  if (!shop.organizationId) {
    return { ok: false, error: "This shop has no team yet. Reload and try again." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const wanted = String(formData.get("role") ?? "staff");
  if (!email.includes("@")) return { ok: false, error: "That address doesn't look right." };
  if (!isShopRole(wanted) || wanted === "owner") {
    // The owner role is not something an invitation may confer. A shop has one
    // owner and it is the person `shops.userId` names.
    return { ok: false, error: "Pick a role." };
  }

  /*
   * DECISION B — fails closed, and this is one of the three shapes the policy
   * names: an existence oracle. Without a ceiling, the invite endpoint is a
   * "does this address have a Sailo account" checker that anyone with one
   * seller account can point at any address in the world.
   */
  const gate = await rateLimit(`team-invite:${shop.id}`, 10, 3_600, {
    onOutage: "closed",
  });
  if (!gate.allowed) {
    return { ok: false, error: "Too many invitations just now. Try again later." };
  }

  /*
   * ONE SENTENCE, WHATEVER HAPPENS.
   *
   * The plugin refuses an address that is already a member, and it answers
   * differently depending on whether the *user* exists. Both of those are
   * facts about somebody else's account, and neither is the inviter's to
   * learn — so the result is swallowed and the same sentence is returned in
   * every case. The person who was invited finds out; the person who typed the
   * address finds out nothing they did not already know.
   *
   * `SUCCESS` is returned even on a thrown refusal, deliberately. Anything
   * else is the oracle rewritten as an error message.
   */
  const SUCCESS = {
    ok: true as const,
    message:
      "If that address can be invited, the invitation is on its way.",
  };

  try {
    await auth.api.createInvitation({
      body: { email, role: wanted as ShopRole, organizationId: shop.organizationId },
      headers: await headers(),
    });
  } catch (error) {
    // Logged server-side so a genuinely broken invite path is visible to us,
    // and never to the caller.
    console.warn(`[sailo] invitation refused for shop ${shop.id}`, error);
    return SUCCESS;
  }

  await recordMemberAction({
    shopId: shop.id,
    actorEmail: actor.email,
    actorRole: role,
    action: "team.invite",
    subjectType: "email",
    /*
     * The address is the subject of the action and the seller needs to see who
     * they invited. Stored here and not treated as a secret: the person who
     * typed it is the one who reads the log.
     */
    subjectId: email,
    detail: { role: wanted },
  });

  revalidatePath("/admin/settings/team");
  return SUCCESS;
}

export async function changeTeamRole(formData: FormData) {
  const { shop, user: actor, role } = await requireShop("team:write");
  const memberId = String(formData.get("memberId") ?? "");
  const wanted = String(formData.get("role") ?? "");
  if (!memberId || !isShopRole(wanted) || wanted === "owner") return;

  const db = getDb();
  const [target] = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, shop.organizationId ?? "")),
    );
  if (!target) return;

  /*
   * The owner cannot be demoted. A shop with nobody able to administer it is
   * unrecoverable, and there is no support path back that does not involve
   * somebody at Sailo editing a row by hand. Checked against `shops.userId`
   * rather than against the role string — the owner of record is the column,
   * and a role that had somehow drifted must not become the way around this.
   */
  if (target.userId === shop.userId) return;

  await db.update(member).set({ role: wanted }).where(eq(member.id, target.id));

  await recordMemberAction({
    shopId: shop.id,
    actorEmail: actor.email,
    actorRole: role,
    action: "team.role",
    subjectType: "member",
    subjectId: target.id,
    detail: { from: target.role, to: wanted },
  });
  revalidatePath("/admin/settings/team");
}

export async function removeTeamMember(formData: FormData) {
  const { shop, user: actor, role } = await requireShop("team:write");
  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) return;

  const db = getDb();
  const [target] = await db
    .select({ id: member.id, userId: member.userId, role: member.role })
    .from(member)
    .where(
      and(eq(member.id, memberId), eq(member.organizationId, shop.organizationId ?? "")),
    );
  if (!target) return;
  // The owner cannot be removed — see `changeTeamRole`.
  if (target.userId === shop.userId) return;

  await db.delete(member).where(eq(member.id, target.id));

  /*
   * REVOCATION ENDS THE SESSION, NOT JUST THE ROW.
   *
   * `requireShop` re-reads the member row on every request, so deleting it is
   * already enough to refuse their *next* one — which is stronger than a role
   * carried in a cookie. But spec 37 asks for the session too, and it is right
   * to: a removed member with a page already open keeps whatever that page
   * rendered until they navigate, and "removed" should not have a lag anybody
   * can measure.
   *
   * Deleting their sessions signs them out of Sailo entirely, which is broader
   * than this shop. That is the honest trade and it is the safe direction: a
   * person removed from the only shop they were in has nothing else here, and
   * a person with their own shop signs back into it in one step.
   */
  await db.delete(session).where(eq(session.userId, target.userId));

  await recordMemberAction({
    shopId: shop.id,
    actorEmail: actor.email,
    actorRole: role,
    action: "team.remove",
    subjectType: "member",
    subjectId: target.id,
    detail: { role: target.role },
  });
  revalidatePath("/admin/settings/team");
}

export async function cancelTeamInvitation(formData: FormData) {
  const { shop, user: actor, role } = await requireShop("team:write");
  const id = String(formData.get("invitationId") ?? "");
  if (!id || !shop.organizationId) return;

  await getDb()
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(eq(invitation.id, id), eq(invitation.organizationId, shop.organizationId)),
    );

  await recordMemberAction({
    shopId: shop.id,
    actorEmail: actor.email,
    actorRole: role,
    action: "team.invite.cancel",
    subjectType: "invitation",
    subjectId: id,
  });
  revalidatePath("/admin/settings/team");
}

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function readTeam(shopId: string, organizationId: string | null) {
  const db = getDb();
  if (!organizationId) return { members: [], invitations: [], actions: [] };

  const [members, invitations, actions] = await Promise.all([
    db
      .select({
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(member.createdAt),
    db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          // Accepted and cancelled ones are history, not a waiting list.
          eq(invitation.status, "pending"),
        ),
      )
      .orderBy(desc(invitation.createdAt)),
    db
      .select()
      .from(shopMemberActions)
      .where(eq(shopMemberActions.shopId, shopId))
      .orderBy(desc(shopMemberActions.createdAt))
      .limit(50),
  ]);

  return { members, invitations, actions };
}
