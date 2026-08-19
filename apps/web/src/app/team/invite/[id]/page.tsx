import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { invitation, organization } from "@sailo/db/schema";
import { getSession } from "@/lib/session";
import { Card } from "@sailo/design-system/web";
import { AcceptInvite } from "./_components/accept-invite";

export const instant = false;
export const metadata: Metadata = {
  title: "An invitation",
  robots: { index: false, follow: false },
};

/**
 * Where an invitation link lands — spec 37.
 *
 * Signed out, it sends them to sign in and comes back here: the invitation is
 * accepted *as a person*, and there is no version of this that works without
 * an account. `next` carries the return, so somebody creating an account gets
 * back to the invitation rather than to an empty admin.
 *
 * The page shows what the shop is and what the role would let them do before
 * they accept — an invitation nobody can read is one people accept blind or
 * ignore, and both are worse for the seller who sent it.
 *
 * It is deliberately **not** an oracle about invitations: an unknown id, an
 * expired one and one that was cancelled all render the same "this invitation
 * is no longer open" — so a stranger walking ids learns nothing about which
 * shops exist or who was invited to them.
 */
export default async function InvitePage({ params }: PageProps<"/team/invite/[id]">) {
  const { id } = await params;

  const session = await getSession();
  if (!session?.user) {
    redirect(`/login?next=${encodeURIComponent(`/team/invite/${id}`)}`);
  }

  const rows = await getDb()
    .select({ invite: invitation, org: organization })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(invitation.id, id),
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const found = rows[0];

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      {found ? (
        <AcceptInvite
          id={id}
          organizationName={found.org.name}
          role={found.invite.role ?? "staff"}
          /*
           * The address the invitation was sent to, compared here rather than
           * only on accept: somebody signed in as the wrong account needs to be
           * told *before* they press a button that will refuse them.
           */
          matchesYou={
            found.invite.email.toLowerCase() === session.user.email.toLowerCase()
          }
          invitedEmail={found.invite.email}
        />
      ) : (
        <Card className="space-y-2 p-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            This invitation is no longer open
          </h1>
          <p className="text-sm text-ink-500">
            It may have been accepted, cancelled, or simply expired. Ask whoever
            sent it for a fresh one.
          </p>
        </Card>
      )}
    </div>
  );
}
