import type { Metadata } from "next";
import { Card, PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { SectionTitle } from "@/app/_components/hq-ui";
import { STAFF_ROLE_SUMMARY, STAFF_ROLES } from "@sailo/security/staff";
import { listStaff } from "@sailo/security/roster";
import { requireStaff } from "@/lib/session";
import {
  InviteMember,
  MemberRowActions,
  ReinstateMember,
} from "./_components/member-controls";

export const metadata: Metadata = { title: "Members" };

const when = (value: Date | null) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/**
 * Who works here.
 *
 * This page is the reason the panel became its own app. Access used to be
 * `SAILO_STAFF_EMAILS` — a comma-separated environment variable — so adding a
 * colleague was a redeploy and removing one was a redeploy somebody had to
 * remember to do. That is a tolerable way to run a list of two founders and a
 * bad way to run a list that includes a contractor.
 *
 * `requireStaff("members:manage")` guards the whole page rather than just the
 * buttons, and answers 403 rather than 404: a support member reaching this URL
 * knows the panel exists — they are signed into it — so pretending the page is
 * missing would only send them to us confused.
 *
 * Revoked members are listed, not hidden. The question this page is really for
 * is "who has been able to see all of this, and when did that stop", and a
 * roster that quietly drops people cannot answer it.
 */
export default async function MembersPage() {
  const actor = await requireStaff("members:manage");
  const members = await listStaff();

  const active = members.filter((m) => !m.revokedAt);
  const revoked = members.filter((m) => m.revokedAt);

  return (
    <>
      <PageHeader
        title="Members"
        description="Who can open this panel, and what they can do in it. Changes take effect on the next request — revoking also ends any session that person is holding."
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <section>
            <SectionTitle>Active — {active.length}</SectionTitle>
            <Table head={<Tr><Th>Member</Th><Th>Role</Th><Th>Added</Th><Th>Last seen</Th><Th align="end">Change</Th></Tr>}>
              {active.length === 0 ? (
                <EmptyRow colSpan={5}>
                  Nobody is on the roster. Whoever is in SAILO_STAFF_EMAILS is
                  still admitted as an owner — add them here to make it real.
                </EmptyRow>
              ) : (
                active.map((m) => (
                  <Tr key={m.email}>
                    <Td>
                      <div className="font-medium text-ink-900">{m.email}</div>
                      {m.note ? (
                        <div className="text-xs text-ink-500">{m.note}</div>
                      ) : null}
                      {m.invitedByEmail ? (
                        <div className="text-xs text-ink-400">
                          added by {m.invitedByEmail}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="text-sm text-ink-900">{m.role}</span>
                      <div className="text-xs text-ink-500">
                        {STAFF_ROLE_SUMMARY[m.role]}
                      </div>
                    </Td>
                    <Td>{when(m.invitedAt)}</Td>
                    {/*
                     * Written on a 15-minute throttle, so "today" here means
                     * "within the last quarter hour", not "this second".
                     */}
                    <Td>{when(m.lastSeenAt)}</Td>
                    <Td align="end">
                      <MemberRowActions
                        email={m.email}
                        role={m.role}
                        isSelf={m.email === actor.email}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </Table>
          </section>

          <section>
            <SectionTitle>Revoked — {revoked.length}</SectionTitle>
            <p className="mb-3 text-sm leading-relaxed text-ink-500">
              Kept on purpose. Nothing here is ever deleted, because the question
              worth answering after an incident is who could see this and when
              that stopped — and a deleted row answers it with silence.
            </p>
            <Table head={<Tr><Th>Member</Th><Th>Was</Th><Th>Revoked</Th><Th>By</Th><Th align="end">Put back</Th></Tr>}>
              {revoked.length === 0 ? (
                <EmptyRow colSpan={5}>Nobody has been removed.</EmptyRow>
              ) : (
                revoked.map((m) => (
                  <Tr key={m.email}>
                    <Td>{m.email}</Td>
                    <Td>{m.role}</Td>
                    <Td>{when(m.revokedAt)}</Td>
                    <Td>{m.revokedByEmail ?? "—"}</Td>
                    <Td align="end">
                      <ReinstateMember email={m.email} role={m.role} />
                    </Td>
                  </Tr>
                ))
              )}
            </Table>
          </section>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionTitle>Add someone</SectionTitle>
            <div className="mt-4">
              <InviteMember />
            </div>
          </Card>

          <Card>
            <SectionTitle>What the roles mean</SectionTitle>
            <dl className="mt-4 space-y-3">
              {STAFF_ROLES.map((r) => (
                <div key={r}>
                  <dt className="text-sm font-medium text-ink-900">{r}</dt>
                  <dd className="text-xs leading-relaxed text-ink-500">
                    {STAFF_ROLE_SUMMARY[r]}
                  </dd>
                </div>
              ))}
            </dl>
            {/*
             * Stated on the screen where someone grants it, because the whole
             * point of three roles is that the person choosing knows what they
             * are handing over.
             */}
            <p className="mt-4 text-xs leading-relaxed text-ink-500">
              Only an owner can open this page. That is deliberate: an account
              that cannot extend its own reach is one whose damage ends when it
              is revoked.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
