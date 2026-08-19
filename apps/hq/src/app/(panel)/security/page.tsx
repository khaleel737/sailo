import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Globe,
  KeyRound,
  Laptop,
  MailWarning,
  Shield,
  ShieldCheck,
  Smartphone,
  Tablet,
  Webhook,
} from "lucide-react";
import { Chart } from "@sailo/design-system/web/chart";
import { PageHeader } from "@sailo/design-system/web";
import { ExportCsv } from "@/app/_components/hq-export";
import { HqFilters } from "@/app/_components/hq-filters";
import { Pagination } from "@/app/_components/hq-pagination";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { RevokeSession } from "@/app/_components/security-actions";
import { Metric, MetricRow, SectionTitle, When } from "@/app/_components/hq-ui";
import { Badge, Card } from "@sailo/design-system/web";
import { countryFlag, countryName } from "@sailo/core/countries";
import {
  first,
  getSecurityOverview,
  getSecurityWatchlist,
  getSessionCountryOptions,
  getSessions,
  WATCHLIST_LIMIT,
  getSignInSeries,
  pageNumber,
} from "@/lib/platform";
import { share } from "@/lib/metrics";

export const metadata: Metadata = { title: "Security" };

const WINDOW_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "day", label: "Started today" },
  { value: "week", label: "Started this week" },
];

const DEVICE_ICON = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Laptop,
} as const;

/**
 * The platform's security posture, and the desk you work it from.
 *
 * Three questions, in the order you ask them after "is something wrong?":
 * what does the whole estate look like, which accounts are exposed, and who
 * exactly is signed in. The revoke buttons are on the last one because that is
 * where the answer to the first two ends up being acted on.
 */
export default async function HqSecurityPage({
  searchParams,
}: PageProps<"/security">) {
  const params = await searchParams;

  const filters = {
    q: first(params.q),
    country: first(params.country),
    window: first(params.window),
    page: pageNumber(params.page),
  };

  const [overview, series, watchlist, sessions, countryCodes] = await Promise.all([
    getSecurityOverview(),
    getSignInSeries(14),
    getSecurityWatchlist(),
    getSessions(filters),
    getSessionCountryOptions(),
  ]);

  const { accounts, exposure, keys, twoFactor, webhooks } = overview;
  const adoption = share(accounts.twoFactor, accounts.total);

  /*
   * The same shape the overview page uses for its attention row, and for the
   * same reason: these are the three findings that are worth interrupting
   * somebody over, and each one is a link to the list that resolves it.
   */
  const attention = [
    exposure.cardsNoTwoFactor > 0
      ? {
          key: "cards",
          tone: "red" as const,
          text: `${exposure.cardsNoTwoFactor} shop${exposure.cardsNoTwoFactor === 1 ? "" : "s"} take card payments with only a password guarding the account.`,
          href: "/accounts?security=cards_no2fa",
        }
      : null,
    twoFactor.failing > 0
      ? {
          key: "codes",
          tone: "amber" as const,
          text: `${twoFactor.failing} account${twoFactor.failing === 1 ? " has" : "s have"} failed two-factor attempts on record${twoFactor.locked > 0 ? `, and ${twoFactor.locked} ${twoFactor.locked === 1 ? "is" : "are"} locked out right now` : ""}.`,
          href: "#watchlist",
        }
      : null,
    keys.dormant > 0
      ? {
          key: "keys",
          tone: "amber" as const,
          text: `${keys.dormant} live API key${keys.dormant === 1 ? " has" : "s have"} gone unused for 90 days — credentials with no upside left.`,
          href: "#watchlist",
        }
      : null,
  ].filter((item) => item !== null);

  return (
    <>
      <PageHeader
        title="Security"
        description="Who is signed in and from where, what guards each account, and which credentials are still live. Nothing on this page shows a secret — only whether one exists."
        action={<ExportCsv type="sessions" label="Export sessions" />}
      />

      <MetricRow>
        <Metric
          icon={<ShieldCheck className="size-4" />}
          label="Two-factor adoption"
          value={`${adoption}%`}
          hint={`${accounts.twoFactor.toLocaleString()} of ${accounts.total.toLocaleString()} accounts`}
          delta={
            exposure.paidNoTwoFactor > 0
              ? {
                  value: `${exposure.paidNoTwoFactor} paying without it`,
                  direction: "down",
                }
              : undefined
          }
        />
        <Metric
          icon={<Laptop className="size-4" />}
          label="Devices signed in"
          value={overview.sessions.live.toLocaleString()}
          hint={`${overview.sessions.accounts.toLocaleString()} accounts · ${overview.sessions.day} signed in today`}
        />
        <Metric
          icon={<MailWarning className="size-4" />}
          label="Unverified emails"
          value={accounts.unverified.toLocaleString()}
          hint={
            exposure.liveUnverified > 0
              ? `${exposure.liveUnverified} of them run a live shop`
              : "None of them run a live shop"
          }
        />
        <Metric
          icon={<KeyRound className="size-4" />}
          label="Live API keys"
          value={keys.live.toLocaleString()}
          hint={`${keys.writable} can write · ${keys.dormant} dormant`}
        />
      </MetricRow>

      <div className="mt-3">
        <MetricRow>
          <Metric
            icon={<Shield className="size-4" />}
            label="Cards, no second factor"
            value={exposure.cardsNoTwoFactor.toLocaleString()}
            hint={`of ${exposure.takingCards.toLocaleString()} shops taking cards`}
          />
          <Metric
            icon={<Laptop className="size-4" />}
            label="Sign-ins · 7 days"
            value={overview.sessions.week.toLocaleString()}
            hint={`${overview.sessions.seenDay.toLocaleString()} sessions used since yesterday`}
          />
          <Metric
            icon={<ShieldCheck className="size-4" />}
            label="Two-factor trouble"
            value={twoFactor.failing.toLocaleString()}
            hint={
              twoFactor.locked > 0
                ? `${twoFactor.locked} locked out right now`
                : "Nobody is locked out"
            }
          />
          <Metric
            icon={<Webhook className="size-4" />}
            label="Endpoints switched off"
            value={webhooks.disabled.toLocaleString()}
            hint={`${webhooks.active} active · ${webhooks.failing} failing`}
          />
        </MetricRow>
      </div>

      {attention.length > 0 ? (
        <div className="mt-6 space-y-2">
          {attention.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={
                item.tone === "red"
                  ? "flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 transition hover:bg-red-100"
                  : "flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition hover:bg-amber-100"
              }
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink-900">
                <AlertTriangle className="size-4 shrink-0 opacity-70" />
                {item.text}
              </span>
              <ArrowRight className="size-4 shrink-0 opacity-60" />
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5">
          <Chart
            title="Sessions started · last 14 days"
            defaultShape="line"
            days={series.map((d) => d.day)}
            series={[
              {
                key: "signins",
                label: "Sign-ins",
                values: series.map((d) => d.value),
              },
            ]}
            tone="activity"
            unit="count"
            emptyLabel="Nobody has signed in this fortnight."
          />
          {/* The honest caveat: this is drawn from live sessions, and a session
              only lives 30 days, so the window has to stay well inside it. */}
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Counted from sessions that are still live. Sessions expire after 30
            days and their row goes with them, which is why this window is a
            fortnight — any longer and the far end would slope to nothing that
            never happened.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-900">
            <Globe className="size-4 text-ink-400" />
            Where they&rsquo;re signed in
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-ink-500">
            Resolved from the edge headers at sign-in.{" "}
            {overview.sessions.live - overview.sessions.located > 0
              ? `${overview.sessions.live - overview.sessions.located} session${overview.sessions.live - overview.sessions.located === 1 ? "" : "s"} arrived without them.`
              : "Every live session has one."}
          </p>
          {overview.countries.length === 0 ? (
            <p className="text-sm text-ink-500">Nothing placed yet.</p>
          ) : (
            <ul className="space-y-2">
              {overview.countries.map((row) => (
                <li key={row.country}>
                  <Link
                    href={`/security?country=${row.country}`}
                    className="focus-ring block rounded-lg py-0.5"
                  >
                    <span className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-ink-700">
                        <span aria-hidden className="me-1.5">
                          {countryFlag(row.country)}
                        </span>
                        {countryName(row.country)}
                      </span>
                      <span className="tabular shrink-0 text-ink-900">
                        {row.sessions.toLocaleString()}
                        <span className="ms-1.5 text-xs text-ink-400">
                          {row.accounts === row.sessions
                            ? ""
                            : `${row.accounts} acct`}
                        </span>
                      </span>
                    </span>
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                      <span
                        className="block h-full rounded-full bg-brand-600"
                        style={{
                          width: `${share(row.sessions, overview.sessions.live)}%`,
                        }}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <SectionTitle>Accounts worth a second look</SectionTitle>
      <div id="watchlist" className="scroll-mt-6">
        {watchlist.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-ink-500">
              Nothing flagged. Every account with money on it has a second
              factor, every live shop verified its email, and nobody is signed
              in from two countries at once.
            </p>
          </Card>
        ) : (
          <Table
            minWidth="48rem"
            head={
              <>
                <Th>Account</Th>
                <Th>What&rsquo;s wrong</Th>
                <Th align="end">Devices</Th>
                <Th align="end">Keys</Th>
                <Th>Guards</Th>
              </>
            }
          >
            {watchlist.map((row) => (
              <Tr key={row.userId}>
                <Td>
                  <Link
                    href={`/accounts/${row.userId}`}
                    className="focus-ring flex min-w-0 flex-col items-start justify-center rounded pointer-coarse:min-h-11"
                  >
                    <span className="max-w-full truncate font-medium text-ink-900">
                      {row.shopName ?? row.name}
                    </span>
                    <span className="max-w-full truncate text-xs text-ink-400">
                      {row.handle ? `/${row.handle} · ` : ""}
                      {row.email}
                    </span>
                  </Link>
                </Td>

                <Td label="What's wrong">
                  <span className="flex flex-wrap gap-1.5">
                    {/*
                      `whitespace-normal`, overriding the Badge default.

                      A badge is normally a one-or-two-word chip and not
                      wrapping is right for it — a wrapped chip makes its whole
                      table row taller. These are not chips: they are sentences
                      ("Takes card payments with no second factor"), and held on
                      one line the widest of them pushed this page 12px past the
                      viewport on a phone. `cn` is tailwind-merge, so the later
                      class wins cleanly rather than fighting the base.
                    */}
                    {row.reasons.map((reason) => (
                      <Badge
                        key={reason.key}
                        tone={reason.tone}
                        dot
                        className="whitespace-normal text-left"
                      >
                        {reason.text}
                      </Badge>
                    ))}
                  </span>
                </Td>

                <Td align="end" className="tabular" label="Devices">
                  {row.liveSessions.toLocaleString()}
                  {row.countries > 1 ? (
                    <span className="ms-1 text-xs text-red-600">
                      /{row.countries}
                    </span>
                  ) : null}
                </Td>

                <Td align="end" className="tabular" label="Keys">
                  {row.liveKeys.toLocaleString()}
                </Td>

                <Td label="Guards">
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={row.twoFactorEnabled ? "green" : "neutral"}>
                      {row.twoFactorEnabled ? "2FA on" : "2FA off"}
                    </Badge>
                    <Badge tone={row.emailVerified ? "green" : "amber"}>
                      {row.emailVerified ? "Verified" : "Unverified"}
                    </Badge>
                    {row.takesCards ? <Badge tone="blue">Cards</Badge> : null}
                    {row.suspended ? <Badge tone="red">Suspended</Badge> : null}
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>

        )}
        {/*
          `getSecurityWatchlist` takes forty and this drew all forty with
          nothing saying so. Forty is a deliberate cap — the list is ranked, so
          the fortieth is by definition the least urgent — but a cap nobody is
          told about reads as a complete list, and somebody works it to the
          bottom believing they are done.
        */}
        {watchlist.length >= WATCHLIST_LIMIT ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            The {WATCHLIST_LIMIT} most exposed accounts. There may be more
            behind them — work this list down and reload, or filter{" "}
            <Link
              href="/accounts?security=cards_no2fa"
              className="underline decoration-ink-300 underline-offset-2 hover:text-ink-700"
            >
              Accounts by what guards them
            </Link>{" "}
            for the whole set.
          </p>
        ) : null}
      </div>

      <SectionTitle>Signed in right now</SectionTitle>
      <HqFilters
        values={{
          q: filters.q,
          country: filters.country,
          window: filters.window,
        }}
        placeholder="Search name, email, handle or IP…"
        fields={[
          {
            name: "country",
            label: "Country",
            options: [
              { value: "all", label: "Any country" },
              ...countryCodes
                .map((code) => ({
                  value: code,
                  label: `${countryFlag(code)} ${countryName(code)}`,
                }))
                .toSorted((a, b) => a.label.localeCompare(b.label)),
            ],
          },
          { name: "window", label: "Started", options: WINDOW_OPTIONS },
        ]}
      />

      <Table
        minWidth="52rem"
        head={
          <>
            <Th>Account</Th>
            <Th>Where</Th>
            <Th>Device</Th>
            <Th>IP</Th>
            <Th align="end">Signed in</Th>
            <Th align="end">
              <span className="sr-only">Actions</span>
            </Th>
          </>
        }
      >
        {sessions.rows.length === 0 ? (
          <EmptyRow colSpan={6}>No sessions match those filters.</EmptyRow>
        ) : (
          sessions.rows.map((row) => {
            const Icon = DEVICE_ICON[row.device];
            const place = [
              row.city,
              row.country ? countryName(row.country) : null,
            ]
              .filter(Boolean)
              .join(", ");

            return (
              <Tr key={row.id}>
                <Td>
                  <Link
                    href={`/accounts/${row.userId}`}
                    className="focus-ring flex min-w-0 flex-col items-start justify-center rounded pointer-coarse:min-h-11"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-ink-900">
                        {row.shopName ?? row.name}
                      </span>
                      {/* Our own sessions are in this list on purpose. Marked,
                          because "who else is in here" has a different answer
                          when the answer is us. */}
                      {row.staff ? <Badge tone="brand">Staff</Badge> : null}
                      {!row.twoFactorEnabled && !row.staff ? (
                        <Badge tone="neutral">No 2FA</Badge>
                      ) : null}
                    </span>
                    <span className="max-w-full truncate text-xs text-ink-400">
                      {row.email}
                    </span>
                  </Link>
                </Td>

                <Td label="Where">
                  {place ? (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>{countryFlag(row.country)}</span>
                      <span className="truncate">{place}</span>
                    </span>
                  ) : (
                    <span className="text-ink-400">Unknown</span>
                  )}
                </Td>

                <Td label="Device">
                  <span className="flex items-center gap-2 text-ink-700">
                    <Icon className="size-4 shrink-0 text-ink-400" />
                    {[row.browser, row.os].filter(Boolean).join(" · ") || "—"}
                  </span>
                </Td>

                <Td label="IP" className="font-mono text-xs text-ink-500">
                  {row.ipAddress ?? "—"}
                </Td>

                <Td align="end" className="text-ink-500" label="Signed in">
                  <When value={row.createdAt} withTime />
                </Td>

                <Td align="end">
                  <RevokeSession sessionId={row.id} />
                </Td>
              </Tr>
            );
          })
        )}
      </Table>

      <Pagination
        page={sessions.page}
        pages={sessions.pages}
        total={sessions.total}
        noun="sessions"
        basePath="/security"
        params={{
          q: filters.q,
          country: filters.country,
          window: filters.window,
        }}
      />
    </>
  );
}
