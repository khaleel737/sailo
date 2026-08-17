"use client";

/**
 * Everybody expected, and who has arrived.
 *
 * Searchable, because a door queue is not alphabetical and the person at the front is whoever
 * turned up. `GuestRow` is here rather than in its own file because it exists only inside this
 * list and reads its search state.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Ban, Loader2, RotateCcw, Search, UserPlus } from "lucide-react";
import { admitByTicket, revokeAdmission, searchDoor, undoAdmission } from "@/lib/actions/tickets";
import type { CheckInState } from "@sailo/commerce/ticketing";
import type { DoorFilter, DoorRow } from "@sailo/commerce/ticketing";
import { interpolate } from "@sailo/i18n";
import { Badge, Button, Card, Field, Input, Select } from "@sailo/design-system/web";
import { WalkUpForm } from "./walk-up-form";
import type { CheckinLabels } from "./labels";
import { SEARCH_DEBOUNCE_MS } from "./labels";

export function DoorList({
  scope,
  initial,
  tiers,
  labels: a,
  canAddWalkUps,
  onResult,
}: {
  scope: { productId: string; token: string | null };
  initial: { rows: DoorRow[]; total: number };
  tiers: string[];
  labels: CheckinLabels;
  canAddWalkUps: boolean;
  onResult: (state: CheckInState) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DoorFilter>("all");
  const [tier, setTier] = useState("");
  const [data, setData] = useState(initial);
  const [loading, startLoading] = useTransition();
  const [adding, setAdding] = useState(false);

  /*
   * Debounced, because this runs against a list of five hundred while
   * somebody types a surname one letter at a time in a queue. The request is
   * also raced: a slow response for "ok" must not land after the response for
   * "okonkwo" and repaint the older answer over the newer one.
   */
  const seq = useRef(0);
  const query = useCallback(
    () => searchDoor({ ...scope, search, status, tier: tier || null }),
    [scope, search, status, tier],
  );

  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      startLoading(async () => {
        const next = await query();
        if (seq.current === mine) setData(next);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  /** After an admission, so the row moves to the other side of the filter. */
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const next = await query();
    if (seq.current === mine) setData(next);
  }, [query]);

  return (
    <div className="space-y-3">
      <Card className="space-y-3 p-4">
        <Field label={a.searchLabel} htmlFor="door-search">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <Input
              id="door-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={a.searchPlaceholder}
              autoComplete="off"
              className="ps-9"
            />
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "out", "in", "revoked"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={`focus-ring rounded-full px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 ${
                status === value
                  ? "bg-ink-900 text-white"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200"
              }`}
            >
              {value === "all"
                ? a.filterAll
                : value === "out"
                  ? a.filterOut
                  : value === "in"
                    ? a.filterIn
                    : a.filterRevoked}
            </button>
          ))}

          {tiers.length > 0 ? (
            <Select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              aria-label={a.allTiers}
              className="ms-auto w-auto text-xs"
            >
              <option value="">{a.allTiers}</option>
              {tiers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </Card>

      {canAddWalkUps ? (
        adding ? (
          <WalkUpForm
            scope={scope}
            labels={a}
            onDone={(state) => {
              setAdding(false);
              onResult(state);
              void reload();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAdding(true)}
          >
            <UserPlus className="size-4" />
            {a.addGuest}
          </Button>
        )
      ) : null}

      {data.rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm font-medium text-ink-900">
            {search ? a.noMatches : a.emptyList}
          </p>
          {!search ? (
            <p className="mt-1 text-xs text-ink-500">{a.emptyListBody}</p>
          ) : null}
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100 p-0">
          {data.rows.map((row) => (
            <GuestRow
              key={row.id}
              row={row}
              scope={scope}
              labels={a}
              onResult={onResult}
              onChanged={reload}
            />
          ))}
        </Card>
      )}

      <p className="flex items-center gap-2 text-center text-xs text-ink-500">
        {loading ? <Loader2 className="size-3 animate-spin" /> : null}
        {interpolate(a.showingOf, {
          shown: data.rows.length,
          total: data.total,
        })}
      </p>
    </div>
  );
}

export function GuestRow({
  row,
  scope,
  labels: a,
  onResult,
  onChanged,
}: {
  row: DoorRow;
  scope: { productId: string; token: string | null };
  labels: CheckinLabels;
  onResult: (state: CheckInState) => void;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const isIn = row.status === "used";
  // A volunteer holds a token; the owner does not. The server enforces this
  // independently — hiding the control just avoids offering a dead button.
  const isOwner = scope.token === null;

  async function admit() {
    setBusy(true);
    try {
      onResult(await admitByTicket({ ...scope, ticketId: row.id }));
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    try {
      await undoAdmission({ ...scope, ticketId: row.id });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  /**
   * Cancelling an admission outright, which is the owner's decision and not a
   * volunteer's — it is about somebody's money, where undo is only about a
   * mis-scan. The server refuses it for a pass-holder regardless; hiding the
   * control is so nobody is offered a button that will not work.
   */
  async function setRevoked(revoked: boolean) {
    setBusy(true);
    try {
      await revokeAdmission({ ticketId: row.id, revoked });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">
          {row.name ?? row.email ?? row.code}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
          {row.tier ? <span>{row.tier}</span> : null}
          <span className="font-mono">{row.code}</span>
          {row.source !== "order" ? (
            <Badge tone="neutral">
              {row.source === "manual" ? a.walkUp : a.comp}
            </Badge>
          ) : null}
          {/* An unpaid order cannot admit, and the volunteer needs to know
              that before they tap rather than after the red screen. */}
          {!row.payable ? <Badge tone="amber">{a.unpaid}</Badge> : null}
          {isIn && row.usedAt ? (
            <span className="text-emerald-700">
              {interpolate(a.inAt, {
                time: new Date(row.usedAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })}
              {row.checkedInBy
                ? ` ${interpolate(a.byWhom, { name: row.checkedInBy })}`
                : ""}
            </span>
          ) : null}
          {row.note ? <span className="italic">{row.note}</span> : null}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {row.status === "void" ? (
          isOwner ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRevoked(false)}
              disabled={busy}
            >
              {a.reinstate}
            </Button>
          ) : null
        ) : isIn ? (
          <Button type="button" variant="ghost" onClick={undo} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {a.undo}
          </Button>
        ) : (
          <>
            {/* Only offered on a ticket nobody has used — cancelling one
                somebody already walked in on would rewrite the attendance
                record of an event that has happened, and the server refuses
                it anyway. */}
            {isOwner ? (
              <Button
                type="button"
                variant="ghost"
                aria-label={a.revoke}
                title={a.revoke}
                onClick={() => setRevoked(true)}
                disabled={busy}
              >
                <Ban className="size-4" />
              </Button>
            ) : null}
            <Button type="button" onClick={admit} disabled={busy || !row.payable}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {a.admit}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Somebody at the door who is not on the list and is being let in anyway.
 *
 * Every event has these — the artist's friend, a late comp, somebody who paid
 * in cash five minutes ago — and without this they are waved past and never
 * counted, so the attendance figure is wrong by however many of them there
 * were.
 */
