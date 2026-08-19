"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";
import type { DataRequest } from "@sailo/db/schema";
import {
  ERASED_CATEGORIES,
  RETAINED_CATEGORIES,
  REFUSAL_REASONS,
  daysLeft,
} from "@sailo/core/privacy";
import {
  eraseBuyerData,
  refuseBuyerRequest,
  releaseDataExport,
} from "@/lib/actions/data-requests";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * One request, with the three things a seller can do about it.
 *
 * **Access and portability are one click.** Sailo assembles it, the seller
 * releases it. That is the whole point: a seller who had to gather this by hand
 * would ask support to run SQL, which is what they do today.
 *
 * **Erasure is one click plus a confirmation showing exactly what will and will
 * not be erased** — from the decision table, not from a sentence written here,
 * so the screen and the code cannot disagree about what is about to happen.
 *
 * Every form submits by hand: React resets an uncontrolled form after a form
 * action, and on the refusal panel that would clear the picklist along with the
 * message telling the seller to pick from it.
 */
export function RequestRow({ request }: { request: DataRequest }) {
  const a = useAdminT();
  const [confirming, setConfirming] = useState(false);
  const [refusing, setRefusing] = useState(false);

  const [releaseState, release, releasing] = useActionState(releaseDataExport, {
    ok: false,
  });
  const [eraseState, erase, erasing] = useActionState(eraseBuyerData, { ok: false });
  const [refuseState, refuse, refusingNow] = useActionState(refuseBuyerRequest, {
    ok: false,
  });

  const left = daysLeft(request.dueBy);
  const answered = request.status === "fulfilled" || request.status === "refused";

  const messages = [releaseState, eraseState, refuseState];
  const error = messages.find((state) => state.error)?.error;
  const success = messages.find((state) => state.ok && state.message)?.message;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{request.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">
              {request.kind === "erasure"
                ? a.dataRequests.kindErasure
                : request.kind === "portability"
                  ? a.dataRequests.kindPortability
                  : a.dataRequests.kindAccess}
            </Badge>
            {answered ? (
              <Badge tone={request.status === "refused" ? "amber" : "green"} dot>
                {request.status === "refused"
                  ? a.dataRequests.refused
                  : a.dataRequests.answered}
              </Badge>
            ) : (
              /*
               * The deadline, coloured by how close it is. Red past it rather
               * than hidden: a missed statutory deadline is a fact the seller
               * has to keep seeing, and a queue that quietly stops showing
               * overdue rows is one that teaches them the queue is optional.
               */
              <Badge tone={left !== null && left <= 7 ? "red" : "blue"} dot>
                {left === null
                  ? a.dataRequests.awaitingBuyer
                  : left < 0
                    ? a.dataRequests.overdue
                    : `${left} ${a.dataRequests.daysLeft}`}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}

      {answered ? null : request.kind === "erasure" ? (
        <div className="space-y-3">
          {!confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
                {a.dataRequests.erase}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setRefusing(true)}>
                {a.dataRequests.refuse}
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                startTransition(() => erase(data));
              }}
              className="space-y-3 rounded-xl bg-ink-50 p-4"
            >
              <input type="hidden" name="requestId" value={request.id} />

              {/*
                Exactly what will and will not happen, read off the same table
                the erasure itself walks. A confirmation screen written by hand
                is one that goes out of date the first time a category is added.
              */}
              <div className="space-y-2 text-xs leading-relaxed">
                <p className="font-semibold text-ink-900">
                  {a.dataRequests.willRemove}
                </p>
                <ul className="list-disc space-y-1 ps-4 text-ink-600">
                  {ERASED_CATEGORIES.map((rule) => (
                    <li key={rule.category}>{rule.reason}</li>
                  ))}
                </ul>
                <p className="pt-1 font-semibold text-ink-900">
                  {a.dataRequests.willKeep}
                </p>
                <ul className="list-disc space-y-1 ps-4 text-ink-600">
                  {RETAINED_CATEGORIES.map((rule) => (
                    <li key={rule.category}>{rule.reason}</li>
                  ))}
                </ul>
              </div>

              <Field label={a.dataRequests.typeErase} htmlFor={`confirm-${request.id}`}>
                <Input id={`confirm-${request.id}`} name="confirm" autoComplete="off" />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" disabled={erasing}>
                  {erasing ? <Loader2 className="size-4 animate-spin" /> : null}
                  {a.dataRequests.erase}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  {a.common.cancel}
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => release(data));
            }}
          >
            <input type="hidden" name="requestId" value={request.id} />
            <Button type="submit" disabled={releasing}>
              {releasing ? <Loader2 className="size-4 animate-spin" /> : null}
              {a.dataRequests.release}
            </Button>
          </form>
          <Button type="button" variant="ghost" onClick={() => setRefusing(true)}>
            {a.dataRequests.refuse}
          </Button>
        </div>
      )}

      {refusing && !answered ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => refuse(data));
          }}
          className="space-y-3 rounded-xl bg-ink-50 p-4"
        >
          <input type="hidden" name="requestId" value={request.id} />
          <Field
            label={a.dataRequests.refusalReason}
            htmlFor={`reason-${request.id}`}
            hint={a.dataRequests.refusalHint}
          >
            <Select id={`reason-${request.id}`} name="reason" defaultValue="">
              <option value="" disabled>
                {a.dataRequests.pickReason}
              </option>
              {REFUSAL_REASONS.map((reason) => (
                <option key={reason.id} value={reason.id}>
                  {reason.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="secondary" disabled={refusingNow}>
              {refusingNow ? <Loader2 className="size-4 animate-spin" /> : null}
              {a.dataRequests.recordRefusal}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRefusing(false)}>
              {a.common.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {request.status === "refused" && request.refusedReason ? (
        <p className="text-xs text-ink-500">
          {REFUSAL_REASONS.find((reason) => reason.id === request.refusedReason)?.body ??
            request.refusedReason}
        </p>
      ) : null}
    </Card>
  );
}
