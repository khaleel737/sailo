import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus, X } from "lucide-react";
import { PageHeader } from "@sailo/design-system/web";
import { SectionTitle, When } from "@/app/_components/hq-ui";
import { Card } from "@sailo/design-system/web";
import { getStaffLog, getSystemHealth } from "@/lib/platform";
import { staffEmails } from "@sailo/security/staff";

export const metadata: Metadata = { title: "System" };

export default async function HqSystemPage() {
  const [health, log] = await Promise.all([
    getSystemHealth(),
    getStaffLog({ limit: 40 }),
  ]);

  const rollupAge = health.rollup.daysBehind;

  return (
    <>
      <PageHeader
        title="System"
        description="What this deployment is wired to, what the nightly jobs did, and who changed what."
      />

      {/*
        `minmax(0,1fr)`, not `1fr`.

        A grid track's default minimum is `auto`, which is the *min-content*
        width of what is in it — and one of the rows below is a `truncate`d
        string of four Stripe price variable names. `white-space: nowrap` makes
        that string's min-content width its full length, the track grew to
        match, and the whole page scrolled sideways by 502px on a phone. The
        column is what has to be told it may be narrower than its contents;
        `min-w-0` further down only lets the text shrink once it is.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            Integrations
          </h2>
          <p className="mb-4 text-xs leading-relaxed text-ink-500">
            Whether each secret is present in this environment. Values are never
            read into this page — only whether something is set.
          </p>
          <ul className="divide-y divide-ink-100">
            {health.integrations.map((item) => (
              <li
                key={item.name}
                className="flex min-w-0 items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink-900">{item.name}</span>
                  {item.detail ? (
                    /*
                      Wraps; it used to `truncate`.

                      `truncate` sets `white-space: nowrap`, and one of these
                      details is a comma-separated list of four Stripe price
                      variables. Its min-content width became the card's, the
                      card's became the grid track's, and the page scrolled
                      sideways by 502px on a phone — for a string whose whole
                      value is being readable. `minmax(0,1fr)` on the columns
                      lets the track shrink; this lets the text use the room.
                    */
                    <span className="block text-xs leading-relaxed text-ink-400">
                      {item.detail}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    item.ok
                      ? "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                      : "inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"
                  }
                >
                  {item.ok ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : (
                    <X className="size-3.5" strokeWidth={3} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-3">
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              What&rsquo;s in the database
            </h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
              {health.tables.map((table) => (
                <div
                  key={table.name}
                  className="flex items-baseline justify-between gap-2 border-b border-ink-100 py-1.5 text-sm"
                >
                  <dt className="text-ink-500">{table.name}</dt>
                  <dd className="tabular font-medium text-ink-900">
                    {table.n.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              Background jobs
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-500">Analytics rollup through</span>
                <span className="text-ink-900">
                  <When value={health.rollup.through} />
                  {rollupAge !== null && rollupAge > 1 ? (
                    <span className="ms-1.5 text-xs text-amber-700">
                      {rollupAge} days behind
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-500">Rolled-up days stored</span>
                <span className="tabular text-ink-900">
                  {health.rollup.rows.toLocaleString()}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-500">Stripe events processed</span>
                <span className="tabular text-ink-900">
                  {health.stripeEvents.total.toLocaleString()}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-ink-500">Last Stripe event</span>
                <span className="text-ink-900">
                  {health.stripeEvents.lastType ? (
                    <>
                      <span className="font-mono text-xs">
                        {health.stripeEvents.lastType}
                      </span>{" "}
                      <When value={health.stripeEvents.lastAt} />
                    </>
                  ) : (
                    <span className="text-ink-400">None yet</span>
                  )}
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-ink-900">
              Who can open HQ
            </h2>
            {/*
              This card used to say access was "an allowlist of email addresses
              … change it with SAILO_STAFF_EMAILS", and listed that variable's
              contents as though it were the roster. That stopped being true
              when `staff_members` replaced it: the table is consulted first and
              the variable only answers when the table has nothing to say about
              an address. Left as it was, this page told whoever read it to edit
              a variable that no longer governs anything — the worst kind of
              stale documentation, because it is rendered from the system it is
              wrong about.
            */}
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              A roster row in <code className="font-mono">staff_members</code>,
              read on every request — so revoking somebody ends their access now
              rather than when their session expires. Manage it on{" "}
              <Link
                href="/members"
                className="underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
              >
                Members
              </Link>
              .
            </p>
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              The addresses below are the break-glass list in{" "}
              <code className="font-mono">SAILO_STAFF_EMAILS</code>. They are
              <strong className="font-medium text-ink-700"> not the roster</strong>:
              they admit as <code className="font-mono">owner</code> only when the
              table has no row for the address at all, so a fresh environment can
              be repaired from inside. A revoked row beats this list — which is
              what makes revocation mean anything.
            </p>
            <ul className="space-y-1">
              {staffEmails().map((email) => (
                <li
                  key={email}
                  className="flex items-center gap-2 text-sm text-ink-900"
                >
                  <Minus className="size-3 text-ink-300" />
                  {email}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <SectionTitle>Staff activity</SectionTitle>
      <Card className="divide-y divide-ink-100">
        {log.length === 0 ? (
          <p className="p-5 text-sm text-ink-500">
            Nothing yet. Comping a plan, suspending a shop or leaving a note all
            get recorded here.
          </p>
        ) : (
          log.map((entry) => (
            /*
              Stacked on a phone, one line on a desk.

              This was a single `flex flex-wrap` row with `shrink-0` on both the
              timestamp and the actor address. At 390px those two took almost
              everything and the sentence between them was squeezed into a
              column about ten characters wide — every entry rendered as a
              vertical ladder of single words. `flex-1` shrinks before it wraps,
              so wrapping was never going to save it; the row has to stop being
              a row.
            */
            <div
              key={entry.id}
              className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3"
            >
              <span className="shrink-0 text-xs text-ink-400">
                <When value={entry.createdAt} withTime />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-ink-900">{entry.summary}</span>{" "}
                {entry.ownerId && entry.shopName ? (
                  <Link
                    href={`/accounts/${entry.ownerId}`}
                    className="text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
                  >
                    {entry.shopName}
                  </Link>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-ink-400">
                {entry.actorEmail}
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}
