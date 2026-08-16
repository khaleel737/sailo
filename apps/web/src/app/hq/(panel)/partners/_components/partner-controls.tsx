"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Card, Field, Input, Textarea } from "@sailo/design-system/web";
import { savePartnerNotes, setPartnerRate } from "@/lib/actions/partner-program";
import { shareLabel } from "@/lib/partners/program";

/**
 * The two things /hq can set on one partner: their rate, and a private note.
 *
 * Two forms rather than one, because they fail for different reasons and a
 * rejected percentage should not throw away a paragraph somebody just typed.
 */
function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" loading={pending}>
      {children}
    </Button>
  );
}

export function PartnerControls({
  partnerId,
  commissionBp,
  hasCustomRate,
  defaultBp,
  notes,
}: {
  partnerId: string;
  /** The rate in force — override or programme default. */
  commissionBp: number;
  hasCustomRate: boolean;
  defaultBp: number;
  notes: string | null;
}) {
  const [rateState, rateAction] = useActionState(setPartnerRate, { ok: false });
  const [noteState, noteAction] = useActionState(savePartnerNotes, { ok: false });

  return (
    <>
      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Their rate</h2>
        <p className="mb-3 text-xs leading-relaxed text-ink-500">
          {hasCustomRate
            ? `On a negotiated ${shareLabel(commissionBp)}. Clear the field to put them back on the programme's ${shareLabel(defaultBp)}.`
            : `On the programme default of ${shareLabel(defaultBp)}. Enter a number to negotiate a different one.`}{" "}
          Changing this affects the <em>next</em> invoice only — every earning
          keeps the rate it was computed at.
        </p>

        <form action={rateAction} className="flex items-end gap-2">
          <input type="hidden" name="partnerId" value={partnerId} />
          <Field
            label="Rate"
            htmlFor={`rate-${partnerId}`}
            hint="%"
            error={rateState.error}
            className="w-32"
          >
            <Input
              id={`rate-${partnerId}`}
              name="percent"
              type="number"
              min={0}
              max={100}
              step="0.5"
              placeholder={String(defaultBp / 100)}
              defaultValue={hasCustomRate ? commissionBp / 100 : ""}
            />
          </Field>
          <div className="pb-0.5">
            <Submit>Save</Submit>
          </div>
        </form>
        {rateState.message ? (
          <p className="mt-2 text-xs text-emerald-700">{rateState.message}</p>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">
          Internal notes
        </h2>
        <p className="mb-3 text-xs text-ink-500">
          Only we see this. The note the partner reads is set when you approve
          or reject them.
        </p>
        <form action={noteAction} className="space-y-2">
          <input type="hidden" name="partnerId" value={partnerId} />
          <Textarea
            name="notes"
            rows={4}
            maxLength={2000}
            defaultValue={notes ?? ""}
            placeholder="Anything worth remembering about this partner."
          />
          <Submit>Save notes</Submit>
        </form>
        {noteState.message ? (
          <p className="mt-2 text-xs text-emerald-700">{noteState.message}</p>
        ) : null}
      </Card>
    </>
  );
}
