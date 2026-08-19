"use client";

import { startTransition, useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@sailo/design-system/web";
import { REFUSAL_REASONS } from "@sailo/core/privacy";
import {
  staffEraseBuyerData,
  staffRefuseDataRequest,
  staffReleaseDataExport,
} from "@/lib/actions/data-requests";

/**
 * Answering on a seller's behalf, from HQ.
 *
 * The controls are hidden from somebody without `privacy:act` — and the actions
 * check it again, which is the part that is actually the control. Hiding a
 * button is a courtesy to the person who cannot use it; the guard is server-side
 * and unconditional.
 *
 * Erasure keeps the typed confirmation the seller's own screen uses. It is more
 * important here, not less: staff are looking at a queue of rows that all look
 * alike, for shops they have no relationship with.
 */
export function StaffAnswer({
  requestId,
  kind,
  canAct,
}: {
  requestId: string;
  kind: string;
  canAct: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [refusing, setRefusing] = useState(false);

  const [releaseState, release, releasing] = useActionState(staffReleaseDataExport, {
    ok: false,
  });
  const [eraseState, erase, erasing] = useActionState(staffEraseBuyerData, {
    ok: false,
  });
  const [refuseState, refuse, refusingNow] = useActionState(staffRefuseDataRequest, {
    ok: false,
  });

  if (!canAct) {
    return (
      <p className="text-xs text-ink-500">
        Answering on a seller&rsquo;s behalf needs the <code>privacy:act</code>{" "}
        capability.
      </p>
    );
  }

  const states = [releaseState, eraseState, refuseState];
  const error = states.find((state) => state.error)?.error;
  const message = states.find((state) => state.ok && state.message)?.message;

  return (
    <div className="space-y-3 border-t border-ink-100 pt-3">
      {error ? <Alert>{error}</Alert> : null}
      {message ? <Alert tone="success">{message}</Alert> : null}

      <p className="text-xs text-ink-500">
        Acting here answers as the shop. It is recorded against the request as{" "}
        <code>sailo:staff:</code> and your address.
      </p>

      <div className="flex flex-wrap gap-2">
        {kind === "erasure" ? (
          <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
            Delete their data
          </Button>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => release(data));
            }}
          >
            <input type="hidden" name="requestId" value={requestId} />
            <Button type="submit" disabled={releasing}>
              {releasing ? <Loader2 className="size-4 animate-spin" /> : null}
              Assemble and send
            </Button>
          </form>
        )}
        <Button type="button" variant="ghost" onClick={() => setRefusing(true)}>
          Refuse
        </Button>
      </div>

      {confirming ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => erase(data));
          }}
          className="space-y-3 rounded-xl bg-ink-50 p-3"
        >
          <input type="hidden" name="requestId" value={requestId} />
          <Field label={'Type "erase" to confirm'} htmlFor={`hq-confirm-${requestId}`}>
            <Input id={`hq-confirm-${requestId}`} name="confirm" autoComplete="off" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={erasing}>
              {erasing ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete their data
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {refusing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => refuse(data));
          }}
          className="space-y-3 rounded-xl bg-ink-50 p-3"
        >
          <input type="hidden" name="requestId" value={requestId} />
          <Field label="Why?" htmlFor={`hq-reason-${requestId}`}>
            <Select id={`hq-reason-${requestId}`} name="reason" defaultValue="">
              <option value="" disabled>
                Choose a reason…
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
              Record the refusal
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRefusing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
