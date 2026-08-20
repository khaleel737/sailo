"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { MAX_SESSIONS, repeatWeekly } from "@sailo/core/tickets";
import type { EventSession } from "@sailo/db/schema";

/**
 * The dates one event actually runs on — spec 50.
 *
 * A weekly class, a three-day conference with day tickets, a workshop run four
 * times: each of those was a separate product, so the seller re-typed
 * everything and the attendee list was split in as many pieces.
 *
 * **No recurrence engine.** "Repeat weekly × N" writes N rows the seller can
 * then edit one at a time, and that is the whole of recurrence here — a shape
 * that never has to answer "what does editing the series do to the one you have
 * already sold tickets for". `repeatWeekly` does the arithmetic in UTC so a
 * 19:00 class stays at 19:00 across a clock change.
 *
 * WHY THE ROWS STAY IN THE FORM WHEN THE LIST IS HIDDEN
 *
 * The mode select above decides whether a buyer meets these dates at all, and
 * switching back to "One date" hides the list. The hidden fields are rendered
 * regardless, because an input that leaves the DOM leaves the `FormData` — and
 * `saveProduct` reads an absent list as "delete them". A seller flipping the
 * select to see what it does, and saving, must not lose eight dates over it.
 */

type Draft = {
  key: string;
  /** Null on a date the seller has just added. */
  id: string | null;
  startsAt: string;
  endsAt: string;
  capacity: string;
  /**
   * Called off, round-tripped and never edited here.
   *
   * There is no control for it — a cancelled date is a mail to its
   * ticket-holders rather than a checkbox — but a row that dropped the flag
   * would quietly put a cancelled session back on sale on the next save.
   */
  cancelled: boolean;
};

let minted = 0;
const nextKey = () => `session-new-${(minted += 1)}`;

/** A Date as `datetime-local` wants it: local wall clock, minute precision. */
function toLocalInput(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function toDraft(session: EventSession): Draft {
  return {
    key: session.id,
    id: session.id,
    startsAt: toLocalInput(session.startsAt),
    endsAt: toLocalInput(session.endsAt),
    // Null shares the product's stock, and a blank box is how that reads.
    capacity: session.capacity === null ? "" : String(session.capacity),
    cancelled: session.isCancelled,
  };
}

export function EventSessionEditor({
  sessions,
  /** Whether the list is on screen. The payload is posted either way. */
  visible,
  /** The event's own start, so the first date does not have to be retyped. */
  eventStartsAt,
}: {
  sessions: EventSession[];
  visible: boolean;
  eventStartsAt: string;
}) {
  const a = useAdminT();
  const [rows, setRows] = useState<Draft[]>(() => sessions.map(toDraft));
  const [count, setCount] = useState("4");

  const patch = (key: string, next: Partial<Draft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const add = (startsAt: string) =>
    setRows((prev) =>
      prev.length >= MAX_SESSIONS
        ? prev
        : [
            ...prev,
            {
              key: nextKey(),
              id: null,
              startsAt,
              endsAt: "",
              capacity: "",
              cancelled: false,
            },
          ],
    );

  /*
   * Repeats from the last date the seller has, falling back to the event's own
   * start. The last one rather than the first, so pressing it twice extends the
   * run instead of writing the same four Tuesdays again.
   */
  const repeatFrom = rows.at(-1)?.startsAt || eventStartsAt;

  const repeat = () => {
    const dates = repeatWeekly(repeatFrom, Number(count) || 0);
    if (dates.length === 0) return;
    setRows((prev) => [
      ...prev,
      ...dates.slice(0, Math.max(0, MAX_SESSIONS - prev.length)).map((startsAt) => ({
        key: nextKey(),
        id: null,
        startsAt,
        endsAt: "",
        capacity: "",
        cancelled: false,
      })),
    ]);
  };

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <input
          key={`payload-${row.key}`}
          type="hidden"
          name="sessions"
          value={JSON.stringify({
            id: row.id,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            capacity: row.capacity,
            cancelled: row.cancelled,
          })}
        />
      ))}

      {visible ? (
        <>
          {rows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-ink-200">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-left text-xs font-medium text-ink-500">
                    <th className="px-3 py-2">{a.productForm.eventStartsAt}</th>
                    <th className="px-3 py-2">{a.productForm.eventEndsAt}</th>
                    <th className="w-32 px-3 py-2">
                      {a.productForm.sessionCapacity}
                    </th>
                    <th className="w-10 px-3 py-2">
                      <span className="sr-only">{a.common.delete}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((row) => (
                    <tr key={row.key} className={row.cancelled ? "opacity-60" : ""}>
                      <td className="px-3 py-2">
                        <Input
                          type="datetime-local"
                          value={row.startsAt}
                          aria-label={a.productForm.eventStartsAt}
                          onChange={(e) =>
                            patch(row.key, { startsAt: e.target.value })
                          }
                          className="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="datetime-local"
                          value={row.endsAt}
                          /* The picker simply does not offer a moment before
                             this date's own start, rather than validating one
                             after the fact. */
                          min={row.startsAt || undefined}
                          aria-label={a.productForm.eventEndsAt}
                          onChange={(e) => patch(row.key, { endsAt: e.target.value })}
                          className="h-9"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          inputMode="numeric"
                          value={row.capacity}
                          /* Blank shares the room, as a tier's blank does. */
                          placeholder="—"
                          aria-label={a.productForm.sessionCapacity}
                          onChange={(e) =>
                            patch(row.key, { capacity: e.target.value })
                          }
                          className="h-9"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${a.common.delete} ${row.startsAt}`}
                          onClick={() =>
                            setRows((prev) => prev.filter((r) => r.key !== row.key))
                          }
                          className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            {rows.length < MAX_SESSIONS ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => add(repeatFrom)}
              >
                <Plus className="size-4" />
                {a.common.add}
              </Button>
            ) : null}

            {/*
              The generator sits beside "Add" rather than in a section of its
              own, because it is the same decision made in bulk: eight rows the
              seller can then edit individually.
            */}
            <Field
              label={a.productForm.sessionGenerateCount}
              htmlFor="sessionGenerateCount"
              className="w-24"
            >
              <Input
                id="sessionGenerateCount"
                /*
                 * Nameless on purpose. It is a control for this editor and not
                 * a field of the product: a `name` here would post a count the
                 * server would have to decide whether to act on twice.
                 */
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="h-9"
              />
            </Field>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={repeat}
              disabled={rows.length >= MAX_SESSIONS || !repeatFrom}
            >
              {a.productForm.sessionGenerate}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
