"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  connectProvider,
  disconnectProvider,
  type LinkedAccountsActionState,
} from "@/lib/actions/social-accounts";
import type {
  LinkedAccounts,
  SocialProviderId,
} from "@/lib/queries/linked-accounts";

const IDLE: LinkedAccountsActionState = { ok: false };

/**
 * **These strings belong in `packages/i18n/src/admin/en.ts`, and are here
 * instead because that package is A05's to write.**
 *
 * Every other label on this page comes from `useAdminT()`. Adding a
 * `linkedAccounts` section to the admin dictionary is a one-file change —
 * locales are `Partial` and merge over English, so the other thirty-four need
 * nothing — but it is a change inside another agent's exclusive path, and
 * reaching across is what the work orders forbid. Lifting this object into
 * that file and swapping `COPY.x` for `a.linkedAccounts.x` is mechanical and
 * is the first thing that should happen once A05 lands.
 */
const COPY = {
  title: "How you sign in",
  body: "The ways you can get into this account. Keep at least one.",
  password: "Password",
  passwordBody: "Set when you signed up.",
  apple: "Apple",
  google: "Google",
  connected: "Connected",
  notConnected: "Not connected",
  connect: "Connect",
  disconnect: "Disconnect",
  onlyWayIn:
    "This is the only way into your account, so it can't be disconnected. Add another first.",
  providerBody: {
    apple: "Sign in with your Apple ID.",
    google: "Sign in with your Google account.",
  },
} as const;

const PROVIDER_LABEL: Record<SocialProviderId, string> = {
  apple: COPY.apple,
  google: COPY.google,
};

function Submit({ label, variant }: { label: string; variant: "secondary" | "ghost" }) {
  // `useFormStatus` reports only on the form it is rendered inside, which is
  // why each row's button is its own component.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * One form per provider, each with its own state, so a refusal appears beside
 * the row that produced it rather than at the top of the card.
 *
 * The provider id is the only thing that travels. Which *account* it attaches
 * to or detaches from is the session's business and is decided on the server.
 */
function ProviderForm({
  provider,
  connected,
}: {
  provider: SocialProviderId;
  connected: boolean;
}) {
  const [state, action] = useActionState(
    connected ? disconnectProvider : connectProvider,
    IDLE,
  );

  return (
    <form action={action}>
      <input type="hidden" name="provider" value={provider} />
      <Submit
        label={connected ? COPY.disconnect : COPY.connect}
        variant={connected ? "ghost" : "secondary"}
      />
      {state.error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{state.error}</p>
      ) : null}
    </form>
  );
}

function Row({
  icon: Icon,
  name,
  detail,
  connected,
  children,
}: {
  icon: typeof KeyRound;
  name: string;
  detail: string;
  connected: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="flex min-w-0 items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-ink-400" />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink-900">{name}</span>
          <span className="block text-xs text-ink-500">{detail}</span>
        </span>
      </span>
      <span className="flex items-center gap-3">
        <Badge tone={connected ? "green" : "neutral"} dot>
          {connected ? COPY.connected : COPY.notConnected}
        </Badge>
        {children}
      </span>
    </li>
  );
}

/**
 * Every way into this account, and the one rule that governs removing them.
 *
 * **The last credential cannot be disconnected.** A seller whose only way in
 * is Google, removing it, would own a shop nobody can ever sign into again —
 * there is no password to reset and the address alone proves nothing. So the
 * button is replaced with the reason rather than left to fail: better-auth
 * refuses the call as well (`allowUnlinkingAll` is false), but a seller should
 * not have to click something to be told it was never allowed.
 *
 * Providers this deployment has no credentials for are absent rather than
 * disabled. A greyed-out "Connect Apple" invites a click that can only ever
 * produce an error, and says nothing true about the account.
 */
export function LinkedAccountsCard({ accounts }: { accounts: LinkedAccounts }) {
  /*
   * `total` counts the password too, because better-auth stores it as an
   * account row like any other — which is exactly why "password plus Google"
   * can drop either one, and "Google alone" can drop neither.
   */
  const isLastCredential = accounts.total <= 1;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <Link2 className="size-4 text-ink-400" />
          {COPY.title}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{COPY.body}</p>
      </div>

      <ul className="divide-y divide-ink-100 border-y border-ink-100">
        {accounts.password ? (
          <Row
            icon={KeyRound}
            name={COPY.password}
            detail={COPY.passwordBody}
            connected
          />
        ) : null}

        {accounts.configured.map((provider) => {
          const connected = accounts.linked[provider];
          return (
            <Row
              key={provider}
              icon={Link2}
              name={PROVIDER_LABEL[provider]}
              detail={COPY.providerBody[provider]}
              connected={connected}
            >
              {connected && isLastCredential ? null : (
                <ProviderForm provider={provider} connected={connected} />
              )}
            </Row>
          );
        })}
      </ul>

      {isLastCredential ? (
        <Alert tone="info">
          <span className="flex items-start gap-2">
            <Unlink className="mt-0.5 size-4 shrink-0" />
            {COPY.onlyWayIn}
          </span>
        </Alert>
      ) : null}
    </Card>
  );
}
