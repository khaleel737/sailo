"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Laptop, Smartphone, Tablet } from "lucide-react";
import { Alert, Badge, Button, Card } from "@sailo/design-system/web";
import {
  useAdminLocale,
  useAdminT,
} from "@/app/admin/_components/admin-i18n";
import { countryName } from "@/lib/countries";
import {
  revokeOtherSessions,
  revokeSessionById,
  type SecurityActionState,
} from "@/lib/actions/security";
import type { LoginSession } from "@/lib/queries/sessions";

const IDLE: SecurityActionState = { ok: false };

const DEVICE_ICON = {
  mobile: Smartphone,
  tablet: Tablet,
  desktop: Laptop,
} as const;

/**
 * "5 minutes ago", in the seller's own language.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled English string: this
 * table is the one place a seller checks when they suspect someone else is in
 * their account, and "5 minutes ago" in a language they don't read is exactly
 * the wrong moment for that.
 *
 * Computed in the browser on purpose. Rendered on the server it would be
 * baked at request time and drift as the page sat open — and, worse, produce
 * a hydration mismatch the moment the two clocks disagreed.
 */
function useRelativeTime() {
  const locale = useAdminLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  return (date: Date) => {
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return rtf.format(Math.round(seconds), "second");
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
    if (abs < 2_592_000) return rtf.format(Math.round(seconds / 86_400), "day");
    if (abs < 31_536_000) {
      return rtf.format(Math.round(seconds / 2_592_000), "month");
    }
    return rtf.format(Math.round(seconds / 31_536_000), "year");
  };
}

/**
 * `useFormStatus` only reports on the form it is rendered *inside*, which is
 * why this is its own component rather than a `pending` flag in the card.
 */
function Submit({
  label,
  variant,
}: {
  label: string;
  variant: "ghost" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * One form per row, each with its own state, so a refusal is reported beside
 * the device it refused to sign out. The row id travels, never the token —
 * the server resolves id → token after checking it belongs to the caller.
 */
function TerminateButton({ id, label }: { id: string; label: string }) {
  const [state, action] = useActionState(revokeSessionById, IDLE);

  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Submit label={label} variant="ghost" />
      {state.error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}

function SignOutOthers({ label }: { label: string }) {
  const [state, action] = useActionState(revokeOtherSessions, IDLE);

  return (
    <form action={action}>
      <Submit label={label} variant="secondary" />
      {state.error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}

export function SessionsCard({ sessions }: { sessions: LoginSession[] }) {
  const a = useAdminT();
  const locale = useAdminLocale();
  const relative = useRelativeTime();

  const others = sessions.filter((s) => !s.current).length;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.security.sessionsTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.security.sessionsBody}</p>
      </div>

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-start text-xs font-medium text-ink-500">
              <th scope="col" className="pb-2 text-start font-medium">
                {a.security.colLocation}
              </th>
              <th scope="col" className="pb-2 text-start font-medium">
                {a.security.colDevice}
              </th>
              <th scope="col" className="pb-2 text-start font-medium">
                {a.security.colIp}
              </th>
              <th scope="col" className="pb-2 text-start font-medium">
                {a.security.colWhen}
              </th>
              <th scope="col" className="pb-2 text-end font-medium">
                <span className="sr-only">{a.columns.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {sessions.map((row) => {
              const Icon = DEVICE_ICON[row.device];
              const place = [row.city, row.country ? countryName(row.country, locale) : null]
                .filter(Boolean)
                .join(", ");

              return (
                <tr key={row.id} className="align-middle">
                  <td className="py-2.5 pe-3 text-ink-900">
                    {place || <span className="text-ink-400">{a.security.unknownLocation}</span>}
                  </td>
                  <td className="py-2.5 pe-3 text-ink-700">
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-ink-400" />
                      {[row.browser, row.os].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </td>
                  <td className="py-2.5 pe-3 font-mono text-xs text-ink-500">
                    {row.ipAddress ?? "—"}
                  </td>
                  <td className="py-2.5 pe-3 text-ink-500">
                    {relative(row.createdAt)}
                  </td>
                  <td className="py-2.5 text-end">
                    {row.current ? (
                      <Badge tone="brand">{a.security.currentSession}</Badge>
                    ) : (
                      <TerminateButton id={row.id} label={a.security.terminate} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {others === 0 ? (
        <Alert tone="info">{a.security.noSessions}</Alert>
      ) : (
        <SignOutOthers label={a.security.signOutOthers} />
      )}
    </Card>
  );
}
