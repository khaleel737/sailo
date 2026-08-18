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

      <div className="grid gap-3 lg:grid-cols-2">
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
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block text-sm text-ink-900">{item.name}</span>
                  {item.detail ? (
                    <span className="block truncate text-xs text-ink-400">
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
            <p className="mb-3 text-xs leading-relaxed text-ink-500">
              An allowlist of email addresses, checked on every request. There is
              no sign-up here — an address must already have a Sailo account, and
              be on this list. Change it with the{" "}
              <code className="font-mono">SAILO_STAFF_EMAILS</code> environment
              variable.
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
            <div
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 text-sm"
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
