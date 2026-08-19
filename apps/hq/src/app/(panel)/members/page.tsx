import type { Metadata } from "next";
import { Card, PageHeader } from "@sailo/design-system/web";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { SectionTitle } from "@/app/_components/hq-ui";
import {
  capabilitiesFor,
  STAFF_ROLE_SUMMARY,
  STAFF_ROLES,
  type StaffCapability,
} from "@sailo/security/staff";
import { listStaff } from "@sailo/security/roster";
import { requireStaff } from "@/lib/session";
import {
  InviteMember,
  MemberRowActions,
  ReinstateMember,
} from "./_components/member-controls";

export const metadata: Metadata = { title: "Members" };

/**
 * What each capability lets somebody do, in the words a person granting it
 * needs rather than the words the code uses.
 *
 * A `Record` over the union, so adding a capability without explaining it is a
 * type error rather than an empty tooltip. The one place the meaning of these
 * is decided is `@sailo/security/staff`; this is the translation for the screen
 * where somebody has to choose between them.
 */
const CAPABILITY_MEANING: Record<StaffCapability, string> = {
  read: "See every account, order, payment and dispute on the platform.",
  "notes:write": "Write an internal note on an account or close a ticket.",
  "account:secure":
    "Sign a seller's devices out and revoke their API keys. Makes an account less reachable.",
  "account:recover":
    "Clear a seller's second factor. Makes an account MORE reachable — this is the one social engineering aims at.",
  "account:suspend":
    "Take a storefront offline, pause a shop's marketing, and flag shops on the risk desk.",
  "billing:grant": "Comp a paid plan, or take one back.",
  "money:move":
    "Refund a charge, pay a partner, and submit dispute evidence to Stripe.",
  "marketing:send": "Send or schedule a campaign to Sailo's own mailing list.",
  "data:export":
    "Download every account, buyer and session as a CSV. This is the one a breach report is about.",
  "privacy:act":
    "Answer a buyer's data request on a seller's behalf — including deleting that buyer's records. Every use is recorded against the request.",
  "platform:contest":
    "Submit evidence to a card network for a chargeback against Sailo's own subscription revenue. Does not include refunding it.",
  "members:manage": "Invite, revoke and re-role everybody on this page.",
};

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
 *
 * The role reference in the sidebar is rendered from `capabilitiesFor`, which
 * is the same table `can()` answers from — never a hand-written list beside it.
 * A roster page advertising a grant the checker does not honour is worse than
 * one that says nothing, because somebody will staff around it.
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
            {/*
              Bare `<Th>`s, not wrapped in a `<Tr>`. `Table` puts the head
              inside its own `<tr>`, so passing one here nested a row inside a
              row — invalid HTML, and React reported it as a hydration error on
              every load of this page. Every other table in the panel passes a
              fragment; this one was the outlier.
            */}
            <Table
              head={
                <>
                  <Th>Member</Th>
                  <Th>Role</Th>
                  <Th>Added</Th>
                  <Th>Last seen</Th>
                  <Th align="end">Change</Th>
                </>
              }
            >
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
            <Table
              head={
                <>
                  <Th>Member</Th>
                  <Th>Was</Th>
                  <Th>Revoked</Th>
                  <Th>By</Th>
                  <Th align="end">Put back</Th>
                </>
              }
            >
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
            {/* Plain heading inside a Card — see the note on the closure page. */}
            <h2 className="mb-4 text-sm font-semibold text-ink-900">Add someone</h2>
            <div className="mt-4">
              <InviteMember />
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-sm font-semibold text-ink-900">What the roles mean</h2>
            <dl className="mt-4 space-y-4">
              {STAFF_ROLES.map((r) => (
                <div key={r}>
                  <dt className="text-sm font-medium text-ink-900">{r}</dt>
                  <dd className="text-xs leading-relaxed text-ink-500">
                    {STAFF_ROLE_SUMMARY[r]}
                  </dd>
                  {/*
                    The grants, spelled out. Somebody choosing a role is making
                    a decision about somebody else's reach, and "support" on its
                    own does not tell them what they are handing over.
                  */}
                  <dd className="mt-1.5 flex flex-wrap gap-1">
                    {capabilitiesFor(r).map((capability) => (
                      <span
                        key={capability}
                        title={CAPABILITY_MEANING[capability]}
                        className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600"
                      >
                        {capability}
                      </span>
                    ))}
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
            <p className="mt-2 text-xs leading-relaxed text-ink-500">
              Every one of these is checked inside the action it guards, not
              only on the screen that offers it. A Server Action is a public
              endpoint with a generated name, so hiding a button is a courtesy
              and never the control.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
