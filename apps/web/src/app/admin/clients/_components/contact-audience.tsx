"use client";

import { startTransition, useActionState } from "react";
import { Loader2, X } from "lucide-react";
import {
  addToContactList,
  removeFromContactList,
  type AudienceActionState,
} from "@/lib/actions/audience";
import { formatAnswer } from "@sailo/marketing/contacts";
import { Alert, Badge, Button, Card, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Which lists this person is on, and what they have answered.
 *
 * The two halves of spec 34 as they reach one contact: the grouping, and the
 * shop's own questions. Both live on this card rather than on separate ones,
 * because they answer the same question a seller is holding when they open a
 * contact — *what do I know about this person that the order does not say.*
 *
 * The remove button is deliberately a small `×` on a chip and not a row with a
 * confirm dialog, and the line under it says why: this removes them from one
 * list. Rule 2 — removal and unsubscribe are two verbs, two buttons, and never
 * one confirm dialog. The unsubscribe verb is not on this screen at all,
 * because it is not the seller's to press.
 */

type ListMembership = {
  id: string;
  name: string;
  status: string;
  joinedAt: Date;
};

type Answer = {
  key: string;
  label: string;
  type: string;
  value: string | number | boolean | null;
};

const IDLE: AudienceActionState = { ok: false };

export function ContactAudience({
  clientId,
  memberships,
  available,
  answers,
  locale,
}: {
  clientId: string;
  memberships: ListMembership[];
  /** Lists this shop has that they are not already on. */
  available: { id: string; name: string }[];
  answers: Answer[];
  locale: string;
}) {
  const a = useAdminT();
  const [added, add] = useActionState<AudienceActionState, FormData>(
    addToContactList,
    IDLE,
  );
  const [removed, remove] = useActionState<AudienceActionState, FormData>(
    removeFromContactList,
    IDLE,
  );

  /*
   * A contact with no lists, no fields defined and nowhere to be added has
   * nothing to show. Rendering an empty card on every contact card in the shop
   * would be a permanent blank that trains the eye to skip that column.
   */
  if (memberships.length === 0 && available.length === 0 && answers.length === 0) {
    return null;
  }

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="mb-2 text-sm font-semibold">{a.broadcasts.listsTitle}</h2>

        {memberships.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-2">
            {memberships.map((list) => (
              <li key={list.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    startTransition(() => remove(data));
                  }}
                >
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="listId" value={list.id} />
                  <Badge tone={list.status === "pending" ? "amber" : "neutral"}>
                    {list.name}
                    {list.status === "pending" ? ` · ${a.common.pending}` : null}
                    <button
                      type="submit"
                      aria-label={a.broadcasts.listRemoveMember}
                      title={a.broadcasts.listRemoveMember}
                      className="focus-ring -me-1 ms-0.5 rounded-full p-0.5 hover:bg-ink-200"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                </form>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Rule 2, in the one place a seller can press the wrong thing. */}
        <p className="text-xs leading-relaxed text-ink-500">
          {a.broadcasts.listRemoveVsUnsubscribe}
        </p>

        {available.length > 0 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => add(data));
            }}
            className="mt-3 flex gap-2"
          >
            <input type="hidden" name="clientId" value={clientId} />
            {/*
              `manual` and not `signup`. The seller is adding them, which is a
              different fact from the person joining — and it is the fact the
              audience screen reports months later when somebody asks where an
              address came from.
            */}
            <input type="hidden" name="source" value="manual" />
            <Select name="listId" defaultValue={available[0]?.id} className="flex-1">
              {available.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </Select>
            <SubmitAdd label={a.common.add} />
          </form>
        ) : null}

        {added.error ? (
          <Alert tone="error" className="mt-2">
            {added.error}
          </Alert>
        ) : null}
        {added.ok && added.message ? (
          <Alert tone="success" className="mt-2">
            {added.message}
          </Alert>
        ) : null}
        {removed.error ? (
          <Alert tone="error" className="mt-2">
            {removed.error}
          </Alert>
        ) : null}
        {removed.ok && removed.message ? (
          <Alert tone="success" className="mt-2">
            {removed.message}
          </Alert>
        ) : null}
      </div>

      {answers.length > 0 ? (
        <div className="border-t border-ink-200 pt-4">
          <h2 className="mb-2 text-sm font-semibold">{a.broadcasts.fieldAnswers}</h2>
          <dl className="space-y-2 text-sm">
            {answers.map((answer) => (
              <div key={answer.key} className="flex gap-2">
                <dt className="min-w-32 shrink-0 text-ink-500">{answer.label}</dt>
                {/*
                  Rendered as text, never as markup. A dropdown option is
                  seller input and a text answer is buyer input; React escapes
                  both here, which is the same boundary merge tags cross in
                  `markdown.ts`.
                */}
                <dd className="text-ink-900">
                  {formatAnswer(answer.value, answer.type, locale) || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </Card>
  );
}

function SubmitAdd({ label }: { label: string }) {
  return (
    <Button type="submit" variant="secondary">
      {label}
    </Button>
  );
}
