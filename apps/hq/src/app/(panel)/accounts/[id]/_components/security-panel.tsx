import {
  Fingerprint,
  Globe,
  KeyRound,
  Laptop,
  Smartphone,
  Tablet,
  Webhook,
} from "lucide-react";
import { EmptyRow, Table, Td, Th, Tr } from "@/app/_components/hq-table";
import { Detail, Mono, SectionTitle, When } from "@/app/_components/hq-ui";
import {
  RevokeApiKey,
  RevokeSession,
} from "@/app/_components/security-actions";
import { Badge, Card } from "@sailo/design-system/web";
import { countryFlag, countryName } from "@sailo/core/countries";
import type { AccountSecurity } from "@/lib/platform";

/* ===========================================================================
   One account's security, as it appears to us.

   The mirror of what the seller sees in Settings → Security, plus the two
   things they can't see about themselves: that a key of theirs has been dead
   for a quarter, and that they are signed in from somewhere they have never
   mentioned. Server-rendered apart from the revoke buttons — a table of six
   sessions should not ship a component tree to draw itself.
=========================================================================== */

const DEVICE_ICON = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Laptop,
} as const;

/** The human name for a better-auth provider id. */
const PROVIDER_LABELS: Record<string, string> = {
  credential: "Email and password",
  google: "Google",
  apple: "Apple",
  github: "GitHub",
};

export function SecurityPanel({
  security,
  emailVerified,
  twoFactorEnabled,
  /**
   * Whether to draw the per-row revoke buttons.
   *
   * `account:secure`, resolved by the page. Defaults to true because the other
   * caller — the platform-wide security desk — already renders only for staff
   * who hold it, and a default of false there would silently remove the buttons
   * that page exists for. The actions behind them check for themselves either
   * way; this only decides what is drawn.
   */
  mayRevoke = true,
}: {
  security: AccountSecurity;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  mayRevoke?: boolean;
}) {
  const { sessions, countries, twoFactor, providers, keys, hooks } = security;
  const liveKeys = keys.filter((key) => !key.revokedAt);

  return (
    <>
      {/*
        No "Security" heading here.

        This panel is now reached only through the account's Security *tab*,
        which is already labelled — so the heading restated the word directly
        under itself and pushed everything down a line for nothing. The panel's
        own sub-headings ("How they get in", "Where from") are what actually
        divide it.
      */}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <Card className="p-4">
          {/*
            `h2`, not `h3`.

            These reported to an `h2` reading "Security" that this panel used to
            render. The tab strip is labelled Security now, so that heading went
            — and left these skipping a level under the page's `h1`, which is
            how a screen reader's heading outline gets a hole in it. Styled
            identically; only the level changed.
          */}
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-400">
            <Fingerprint className="size-3.5" />
            How they get in
          </h2>
          <div className="space-y-3">
            <Detail label="Second factor">
              {twoFactorEnabled ? (
                <Badge tone="green" dot>
                  On
                </Badge>
              ) : (
                <Badge tone="amber" dot>
                  Off — password only
                </Badge>
              )}
              {/* Enrolled but unverified means they scanned the QR and never
                  typed a code back. The plugin leaves it inert, so it is worth
                  saying out loud rather than reading as "on". */}
              {twoFactor && !twoFactor.verified ? (
                <span className="ms-2 text-xs text-ink-500">
                  enrolled but never confirmed
                </span>
              ) : null}
            </Detail>

            {twoFactor && twoFactor.failedVerificationCount > 0 ? (
              <Detail label="Wrong codes tried">
                <span className="text-red-700">
                  {twoFactor.failedVerificationCount}
                </span>
                {twoFactor.lockedUntil ? (
                  <span className="ms-2 text-xs text-ink-500">
                    locked until <When value={twoFactor.lockedUntil} withTime />
                  </span>
                ) : null}
              </Detail>
            ) : null}

            <Detail label="Email">
              {emailVerified ? "Verified" : "Never verified"}
            </Detail>

            <Detail label="Sign-in methods">
              {providers.length === 0 ? (
                <span className="text-ink-400">None on record</span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {providers.map((provider) => (
                    <Badge key={provider.id} tone="neutral">
                      {PROVIDER_LABELS[provider.providerId] ??
                        provider.providerId}
                      {provider.providerId !== "credential" &&
                      provider.hasPassword
                        ? " + password"
                        : ""}
                    </Badge>
                  ))}
                </span>
              )}
            </Detail>

            <Detail label="Devices signed in">
              {sessions.length.toLocaleString()}
              {countries.length > 1 ? (
                <span className="ms-2 text-xs font-medium text-red-700">
                  across {countries.length} countries
                </span>
              ) : null}
            </Detail>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-400">
            <Globe className="size-3.5" />
            Where from
          </h2>
          {countries.length === 0 ? (
            <p className="text-sm text-ink-500">
              Nowhere placed. Sessions carry a country only when the edge
              headers had one — local sign-ins and older sessions have nothing
              truthful to say.
            </p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {countries.map((code) => (
                  <li key={code}>
                    <Badge tone={countries.length > 1 ? "amber" : "neutral"}>
                      <span aria-hidden>{countryFlag(code)}</span>
                      {countryName(code)}
                    </Badge>
                  </li>
                ))}
              </ul>
              {countries.length > 1 ? (
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  Two countries at once is usually a VPN or a trip. It is also
                  what a shared password looks like, so it is worth one message
                  to the seller before it is worth anything else.
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>

      <div className="mt-3">
        <Table
          minWidth="44rem"
          head={
            <>
              <Th>Where</Th>
              <Th>Device</Th>
              <Th>IP</Th>
              <Th align="end">Signed in</Th>
              <Th align="end">Expires</Th>
              <Th align="end">
                <span className="sr-only">Actions</span>
              </Th>
            </>
          }
        >
          {sessions.length === 0 ? (
            <EmptyRow colSpan={6}>Nobody is signed in to this account.</EmptyRow>
          ) : (
            sessions.map((row) => {
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
                    {place ? (
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden>{countryFlag(row.country)}</span>
                        <span className="truncate text-ink-900">{place}</span>
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
                  <Td align="end" className="text-ink-500" label="Expires">
                    <When value={row.expiresAt} />
                  </Td>
                  <Td align="end">
                    {mayRevoke ? <RevokeSession sessionId={row.id} /> : null}
                  </Td>
                </Tr>
              );
            })
          )}
        </Table>
      </div>

      {keys.length > 0 ? (
        <>
          <SectionTitle>API keys</SectionTitle>
          <Table
            minWidth="44rem"
            head={
              <>
                <Th>Label</Th>
                <Th>Prefix</Th>
                <Th>Scopes</Th>
                <Th align="end">Last used</Th>
                <Th align="end">Created</Th>
                <Th align="end">
                  <span className="sr-only">Actions</span>
                </Th>
              </>
            }
          >
            {keys.map((key) => (
              <Tr key={key.id}>
                <Td>
                  <span className="flex min-w-0 items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-ink-400" />
                    <span className="truncate text-ink-900">{key.label}</span>
                    {key.revokedAt ? (
                      <Badge tone="neutral">Revoked</Badge>
                    ) : null}
                  </span>
                </Td>
                <Td label="Prefix">
                  {/* The non-secret head of the token. The entropy is in the
                      tail, which we never stored and cannot print. */}
                  <Mono>{key.prefix}</Mono>
                </Td>
                <Td label="Scopes">
                  <span className="flex flex-wrap gap-1.5">
                    {key.scopes.map((scope) => (
                      <Badge
                        key={scope}
                        tone={scope === "write" ? "amber" : "neutral"}
                      >
                        {scope}
                      </Badge>
                    ))}
                  </span>
                </Td>
                <Td align="end" className="text-ink-500" label="Last used">
                  {key.lastUsedAt ? (
                    <When value={key.lastUsedAt} />
                  ) : (
                    <span className="text-ink-400">Never</span>
                  )}
                </Td>
                <Td align="end" className="text-ink-500" label="Created">
                  <When value={key.createdAt} />
                </Td>
                <Td align="end">
                  {key.revokedAt ? (
                    <span className="text-xs text-ink-400">
                      <When value={key.revokedAt} />
                    </span>
                  ) : mayRevoke ? (
                    <RevokeApiKey keyId={key.id} />
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Table>
          {liveKeys.length > 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              These open{" "}
              <code className="font-mono">/api/v1</code> and{" "}
              <code className="font-mono">/api/mcp</code> for this shop. Revoking
              is a stamp, not a delete — the row survives so the question &ldquo;what
              was that key, and when did we turn it off&rdquo; keeps an answer.
            </p>
          ) : null}
        </>
      ) : null}

      {hooks.length > 0 ? (
        <>
          <SectionTitle>Webhook endpoints</SectionTitle>
          <Table
            minWidth="44rem"
            head={
              <>
                <Th>Endpoint</Th>
                <Th>Events</Th>
                <Th>State</Th>
                <Th align="end">Failures</Th>
                <Th align="end">Last attempt</Th>
              </>
            }
          >
            {hooks.map((hook) => (
              <Tr key={hook.id}>
                <Td>
                  <span className="flex min-w-0 items-center gap-2">
                    <Webhook className="size-4 shrink-0 text-ink-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-ink-900">
                        {hook.label ?? hook.url}
                      </span>
                      {hook.label ? (
                        <span className="block truncate text-xs text-ink-400">
                          {hook.url}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Td>
                <Td label="Events" className="text-xs text-ink-500">
                  {hook.events.length === 0 ? "None" : hook.events.join(", ")}
                </Td>
                <Td label="State">
                  {hook.isActive ? (
                    <Badge tone="green" dot>
                      Active
                    </Badge>
                  ) : (
                    <Badge tone="red" dot>
                      Off
                      {hook.disabledReason ? ` — ${hook.disabledReason}` : ""}
                    </Badge>
                  )}
                </Td>
                <Td align="end" className="tabular" label="Failures">
                  {hook.failureCount}
                  {hook.lastStatus ? (
                    <span className="ms-1.5 text-xs text-ink-400">
                      {hook.lastStatus}
                    </span>
                  ) : null}
                </Td>
                <Td align="end" className="text-ink-500" label="Last attempt">
                  <When value={hook.lastAttemptAt} withTime />
                </Td>
              </Tr>
            ))}
          </Table>
        </>
      ) : null}
    </>
  );
}
