"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  createApiKey,
  revokeApiKey,
  type IntegrationState,
} from "@/lib/actions/integrations";
import { MAX_API_KEYS_PER_SHOP } from "@sailo/webhooks/events";
import { interpolate } from "@sailo/i18n";
import { RevealOnce } from "./reveal-once";

const IDLE: IntegrationState = { ok: false };

export type KeyRow = {
  id: string;
  label: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
};

function Submit({
  label,
  variant = "secondary",
}: {
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {label}
    </Button>
  );
}

function CreateKey() {
  const a = useAdminT();
  const [state, action] = useActionState(createApiKey, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-ink-200 p-4">
      <Field
        label={a.integrations.keyNameLabel}
        htmlFor="key-label"
        help={a.integrations.keyNameHint}
      >
        <Input id="key-label" name="label" maxLength={60} autoComplete="off" required />
      </Field>

      {/*
        Read is checked and cannot be unchecked — a key with no scopes at all
        would authenticate and then refuse everything, which is a support
        ticket rather than a configuration. Write is the deliberate extra tick,
        and the server defaults to read-only whatever arrives.
      */}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-ink-700">
          {a.integrations.scopeRead} / {a.integrations.scopeWrite}
        </legend>

        <label className="flex items-start gap-2 text-xs text-ink-700 pointer-coarse:min-h-11 pointer-coarse:items-center">
          <input
            type="checkbox"
            name="scopes"
            value="read"
            defaultChecked
            readOnly
            className="mt-0.5 size-3.5 rounded border-ink-300 pointer-coarse:size-5"
          />
          <span>
            <span className="font-medium">{a.integrations.scopeRead}</span>
            <span className="block text-ink-500">{a.integrations.scopeReadHint}</span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs text-ink-700 pointer-coarse:min-h-11 pointer-coarse:items-center">
          <input
            type="checkbox"
            name="scopes"
            value="write"
            className="mt-0.5 size-3.5 rounded border-ink-300 pointer-coarse:size-5"
          />
          <span>
            <span className="font-medium">{a.integrations.scopeWrite}</span>
            <span className="block text-ink-500">{a.integrations.scopeWriteHint}</span>
          </span>
        </label>
      </fieldset>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.secret ? (
        <RevealOnce
          title={a.integrations.tokenTitle}
          body={a.integrations.tokenBody}
          value={state.secret}
        />
      ) : null}

      <Submit label={a.integrations.addKey} variant="primary" />
    </form>
  );
}

export function ApiKeysCard({
  keys,
  contactCount,
  mcpUrl,
  mcpDocsUrl,
}: {
  keys: KeyRow[];
  contactCount: number;
  /** This deployment's MCP endpoint, for the seller to paste into a client. */
  mcpUrl: string;
  /**
   * The MCP page on docs.sailo.store.
   *
   * Passed in beside `mcpUrl` and for the same reason: this is a client
   * component, and both addresses belong to deployments it should not be
   * guessing the hostname of.
   */
  mcpDocsUrl: string;
}) {
  const a = useAdminT();
  const locale = useAdminLocale();

  const format = (date: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date));

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.integrations.keysTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.integrations.keysBody}</p>
      </div>

      {keys.length === 0 ? (
        <p className="text-xs text-ink-500">{a.integrations.noKeys}</p>
      ) : (
        <ul className="divide-y divide-ink-200">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{key.label}</p>
                <p className="mt-0.5 font-mono text-xs text-ink-500">
                  {key.prefix}… · {key.scopes.join(", ")}
                </p>
                <p className="text-xs text-ink-500">
                  {key.lastUsedAt
                    ? interpolate(a.integrations.lastUsed, {
                        when: format(key.lastUsedAt),
                      })
                    : a.integrations.neverUsed}
                </p>
              </div>
              <form action={revokeApiKey}>
                <input type="hidden" name="id" value={key.id} />
                <Submit label={a.integrations.revoke} variant="ghost" />
              </form>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-ink-500">
        {interpolate(a.integrations.keyLimit, {
          count: String(keys.length),
          max: String(MAX_API_KEYS_PER_SHOP),
        })}{" "}
        {interpolate(a.integrations.readable, { count: String(contactCount) })}
      </p>

      {keys.length < MAX_API_KEYS_PER_SHOP ? <CreateKey /> : null}

      {/*
        The MCP address sits under the keys rather than in a card of its own,
        because it is useless without one — an assistant is configured with
        both at the same moment, and separating them would mean a seller
        copying the URL and then hunting for where keys live.
      */}
      <div className="space-y-2 border-t border-ink-200 pt-4">
        <h3 className="text-sm font-semibold text-ink-900">
          {a.integrations.mcpTitle}
        </h3>
        <p className="text-xs text-ink-500">{a.integrations.mcpBody}</p>
        <Field label={a.integrations.mcpUrlLabel} htmlFor="mcp-url">
          <Input
            id="mcp-url"
            readOnly
            value={mcpUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
        </Field>
        {/*
          A new tab, and a plain anchor rather than `Link`: the documentation is
          a different deployment on a different host, and a seller reading it
          has an uncopied URL and a half-filled key form on this one.
        */}
        <a
          href={mcpDocsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-block text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {a.integrations.mcpDocsLink}
        </a>
      </div>
    </Card>
  );
}
