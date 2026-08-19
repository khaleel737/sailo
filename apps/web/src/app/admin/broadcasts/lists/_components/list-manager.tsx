"use client";

import { startTransition, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createContactList,
  deleteContactList,
  updateContactList,
  type AudienceActionState,
} from "@/lib/actions/audience";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Switch,
} from "@sailo/design-system/web";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Making lists, and the two counts that describe one.
 *
 * `pending` is shown beside `subscribed` rather than folded into it, because a
 * list of two hundred where forty have not confirmed reaches a hundred and
 * sixty — and a seller who reads one number and sends to it will report the
 * gap as a bug in the send. Rule 6, as a column.
 */

/**
 * Submits without letting React reset the form.
 *
 * `<form action={dispatch}>` clears every uncontrolled field the moment the
 * action resolves — including when it *refused*. A seller told "you already
 * have a list with that name" would watch the description they had just typed
 * empty itself at the same moment, which is the one refusal they could act on
 * costing them everything else. Dispatching inside a transition ourselves
 * keeps React out of the submit, so the DOM is left as the seller left it.
 * `required` still runs first: the browser validates before `submit` fires.
 *
 * The same reasoning, and the same fix, as `product-form.tsx`.
 */
function byHand(action: (data: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

type ListRow = {
  id: string;
  name: string;
  description: string | null;
  doubleOptIn: boolean;
  subscribedCount: number;
  pendingCount: number;
};

const IDLE: AudienceActionState = { ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function ListManager({ lists }: { lists: ListRow[] }) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {open ? null : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {a.broadcasts.listNew}
          </Button>
        )}
      </div>

      {open ? <NewList onDone={() => setOpen(false)} /> : null}

      {lists.length === 0 && !open ? (
        <EmptyState
          title={a.broadcasts.listsEmpty}
          description={a.broadcasts.listsEmptyBody}
        />
      ) : (
        <div className="space-y-3">
          {lists.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewList({ onDone }: { onDone: () => void }) {
  const a = useAdminT();
  const [state, action] = useActionState<AudienceActionState, FormData>(
    createContactList,
    IDLE,
  );

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">{a.broadcasts.listNew}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={a.common.cancel} onClick={onDone}>
          <X className="size-4" />
        </Button>
      </div>

      <form onSubmit={byHand(action)} className="space-y-3">
        <Field label={a.broadcasts.listName} htmlFor="list-name">
          <Input id="list-name" name="name" maxLength={60} required autoComplete="off" />
        </Field>
        <Field label={a.broadcasts.listDescriptionLabel} htmlFor="list-description">
          <Input id="list-description" name="description" maxLength={200} autoComplete="off" />
        </Field>

        {/*
          Defaulted on, and the hint says whose problem it is. A seller reads
          "confirm by email" as friction for them; it is not — it is the shared
          sending domain, which is every other seller's order confirmations.
        */}
        <Switch
          name="doubleOptIn"
          defaultChecked
          label={a.broadcasts.listDoubleOptIn}
          description={a.broadcasts.listDoubleOptInHint}
        />

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

        <div className="flex justify-end">
          <Submit label={a.common.save} />
        </div>
      </form>
    </Card>
  );
}

function ListCard({ list }: { list: ListRow }) {
  const a = useAdminT();
  const [state, action] = useActionState<AudienceActionState, FormData>(
    updateContactList,
    IDLE,
  );
  const [removing, remove] = useActionState<AudienceActionState, FormData>(
    deleteContactList,
    IDLE,
  );

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{list.name}</h3>
          {list.description ? (
            <p className="mt-0.5 text-xs text-ink-500">{list.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            {interpolate(a.broadcasts.listMembers, { count: list.subscribedCount })}
          </Badge>
          {/*
            Only when there are any. A permanent "0 waiting to confirm" beside
            every list is noise that trains a seller to stop reading the row.
          */}
          {list.pendingCount > 0 ? (
            <Badge tone="amber">
              {interpolate(a.broadcasts.listPending, { count: list.pendingCount })}
            </Badge>
          ) : null}
        </div>
      </div>

      <form onSubmit={byHand(action)} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="listId" value={list.id} />
        <Field label={a.broadcasts.listName} htmlFor={`name-${list.id}`}>
          <Input
            id={`name-${list.id}`}
            name="name"
            defaultValue={list.name}
            maxLength={60}
            required
          />
        </Field>
        <Field label={a.broadcasts.listDescriptionLabel} htmlFor={`desc-${list.id}`}>
          <Input
            id={`desc-${list.id}`}
            name="description"
            defaultValue={list.description ?? ""}
            maxLength={200}
          />
        </Field>

        <div className="sm:col-span-2">
          <Switch
            name="doubleOptIn"
            defaultChecked={list.doubleOptIn}
            label={a.broadcasts.listDoubleOptIn}
          />
        </div>

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="sm:col-span-2">
            <Alert tone="success">{state.message}</Alert>
          </div>
        ) : null}

        <div className="flex justify-end sm:col-span-2">
          <Submit label={a.common.save} />
        </div>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          /*
           * The confirm says what does *not* happen. Rule 2: a seller deleting
           * a list is tidying, and the fear they arrive with — that they are
           * about to unsubscribe two hundred people — is the one thing this
           * button never does.
           */
          if (!window.confirm(a.broadcasts.listDeleteConfirm)) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => remove(data));
        }}
        className="border-t border-ink-200 pt-3"
      >
        <input type="hidden" name="listId" value={list.id} />
        <Button type="submit" variant="ghost" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700">
          <Trash2 className="size-4" />
          {a.broadcasts.listDelete}
        </Button>
        {removing.error ? (
          <div className="mt-2">
            <Alert tone="error">{removing.error}</Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
