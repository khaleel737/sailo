"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useAdminLocale, useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  rotateWebhookSecret,
  sendTestWebhook,
  updateWebhookEndpoint,
  type IntegrationState,
} from "@/lib/actions/integrations";
import {
  MAX_ENDPOINTS_PER_SHOP,
  WEBHOOK_EVENTS,
} from "@/lib/webhooks/events";
import { interpolate } from "@/i18n";
import { RevealOnce } from "./reveal-once";

const IDLE: IntegrationState = { ok: false };

export type EndpointRow = {
  id: string;
  url: string;
  label: string | null;
  events: string[];
  isActive: boolean;
  disabledReason: string | null;
  failureCount: number;
  lastAttemptAt: Date | null;
  lastStatus: string | null;
  lastResponseStatus: number | null;
};

/**
 * `useFormStatus` reports only on the form it is rendered *inside*, which is
 * why every submit here is its own component rather than a flag on the card.
 */
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

/**
 * The event checkboxes.
 *
 * Rendered from `WEBHOOK_EVENTS` rather than a list written out here, so the
 * catalogue and the form cannot disagree — an event added to the emit side and
 * forgotten here would be one no seller could ever subscribe to.
 *
 * The names are deliberately *not* translated. They are the literal strings a
 * consumer matches on — `order.paid` arrives in the `type` field of every
 * payload — and a German seller reading "Bestellung bezahlt" here would have no
 * way to know what to filter their Zap on.
 */
function EventBoxes({ selected }: { selected: readonly string[] }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {WEBHOOK_EVENTS.map((event) => (
        <label
          key={event}
          className="flex items-center gap-2 text-xs text-ink-700"
        >
          <input
            type="checkbox"
            name="events"
            value={event}
            defaultChecked={selected.includes(event)}
            className="size-3.5 rounded border-ink-300"
          />
          <span className="font-mono">{event}</span>
        </label>
      ))}
    </div>
  );
}

function AddEndpoint() {
  const a = useAdminT();
  const [state, action] = useActionState(createWebhookEndpoint, IDLE);

  return (
    <form action={action} className="space-y-3 rounded-xl border border-ink-200 p-4">
      <Field label={a.integrations.urlLabel} htmlFor="url" help={a.integrations.urlHint}>
        <Input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>

      <Field label={a.integrations.nameLabel} htmlFor="label" help={a.integrations.nameHint}>
        <Input id="label" name="label" autoComplete="off" maxLength={80} />
      </Field>

      <Field label={a.integrations.eventsLabel} help={a.integrations.eventsHint}>
        <EventBoxes selected={[]} />
      </Field>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.secret ? (
        <RevealOnce
          title={a.integrations.secretTitle}
          body={a.integrations.secretBody}
          value={state.secret}
        />
      ) : null}

      <Submit label={a.integrations.addEndpoint} variant="primary" />
    </form>
  );
}

function EndpointRowForm({ endpoint }: { endpoint: EndpointRow }) {
  const a = useAdminT();
  const locale = useAdminLocale();
  const [saved, save] = useActionState(updateWebhookEndpoint, IDLE);
  const [rotated, rotate] = useActionState(rotateWebhookSecret, IDLE);
  const [tested, test] = useActionState(sendTestWebhook, IDLE);

  const when = endpoint.lastAttemptAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(endpoint.lastAttemptAt))
    : null;

  return (
    <div className="space-y-3 rounded-xl border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-ink-900">{endpoint.url}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {when
              ? `${interpolate(a.integrations.lastAttempt, { when })}${
                  endpoint.lastResponseStatus
                    ? ` · ${endpoint.lastResponseStatus}`
                    : ""
                }`
              : a.integrations.neverSent}
          </p>
        </div>
        <span
          className={
            endpoint.isActive
              ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"
              : "rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600"
          }
        >
          {endpoint.isActive ? a.integrations.active : a.integrations.disabled}
        </span>
      </div>

      {/*
        Why it stopped, verbatim from the last attempt. A seller whose Zap has
        gone quiet needs the status code or the timeout, not "an error
        occurred" — it is the sentence they will forward to whoever runs the
        receiving end.
      */}
      {!endpoint.isActive && endpoint.disabledReason ? (
        <Alert tone="warning">
          {interpolate(a.integrations.disabledBecause, {
            reason: endpoint.disabledReason,
          })}
        </Alert>
      ) : null}

      <form action={save} className="space-y-3">
        <input type="hidden" name="id" value={endpoint.id} />

        <Field label={a.integrations.nameLabel} htmlFor={`label-${endpoint.id}`}>
          <Input
            id={`label-${endpoint.id}`}
            name="label"
            defaultValue={endpoint.label ?? ""}
            maxLength={80}
            autoComplete="off"
          />
        </Field>

        <Field label={a.integrations.eventsLabel}>
          <EventBoxes selected={endpoint.events} />
        </Field>

        <label className="flex items-center gap-2 text-xs text-ink-700">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={endpoint.isActive}
            className="size-3.5 rounded border-ink-300"
          />
          {a.integrations.active}
        </label>

        {saved.error ? <Alert tone="error">{saved.error}</Alert> : null}
        <Submit label={a.integrations.save} />
      </form>

      <div className="flex flex-wrap gap-2 border-t border-ink-200 pt-3">
        <form action={test}>
          <input type="hidden" name="id" value={endpoint.id} />
          <Submit label={a.integrations.sendTest} variant="ghost" />
        </form>
        <form action={rotate}>
          <input type="hidden" name="id" value={endpoint.id} />
          <Submit label={a.integrations.rotate} variant="ghost" />
        </form>
        <form action={deleteWebhookEndpoint}>
          <input type="hidden" name="id" value={endpoint.id} />
          <Submit label={a.integrations.remove} variant="ghost" />
        </form>
      </div>

      {tested.message ? <Alert tone="success">{tested.message}</Alert> : null}
      {tested.error ? <Alert tone="error">{tested.error}</Alert> : null}
      {rotated.error ? <Alert tone="error">{rotated.error}</Alert> : null}
      {rotated.secret ? (
        <RevealOnce
          title={a.integrations.secretTitle}
          body={rotated.message ?? a.integrations.secretBody}
          value={rotated.secret}
        />
      ) : null}
    </div>
  );
}

export function WebhooksCard({ endpoints }: { endpoints: EndpointRow[] }) {
  const a = useAdminT();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.integrations.webhooksTitle}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.integrations.webhooksBody}</p>
      </div>

      {endpoints.length === 0 ? (
        <p className="text-xs text-ink-500">{a.integrations.noEndpoints}</p>
      ) : (
        <div className="space-y-3">
          {endpoints.map((endpoint) => (
            <EndpointRowForm key={endpoint.id} endpoint={endpoint} />
          ))}
        </div>
      )}

      <p className="text-xs text-ink-500">
        {interpolate(a.integrations.endpointLimit, {
          count: String(endpoints.length),
          max: String(MAX_ENDPOINTS_PER_SHOP),
        })}
      </p>

      {endpoints.length < MAX_ENDPOINTS_PER_SHOP ? <AddEndpoint /> : null}
    </Card>
  );
}
