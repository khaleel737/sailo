"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  BadgeCheck,
  Ban,
  CircleAlert,
  Loader2,
  RotateCcw,
  Search,
  TicketX,
  UserPlus,
} from "lucide-react";
import {
  admitByCode,
  admitByTicket,
  addWalkUp,
  doorStats,
  revokeAdmission,
  searchDoor,
  undoAdmission,
} from "@/lib/actions/tickets";
import type { CheckInState } from "@/lib/tickets";
import type { DoorFilter, DoorRow, DoorStats } from "@/lib/queries/tickets";
import { interpolate } from "@/i18n";
import type { AdminDictionary } from "@/i18n/admin/en";
import { Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Scanner } from "./scanner";
import { signal } from "./feedback";

/**
 * One door, whoever is standing at it.
 *
 * The owner reaches this through `/admin/checkin/[productId]` and a volunteer
 * through `/door/[token]`; the only difference is the `token` prop, which
 * every action carries back so the server can decide what that caller may
 * touch. Labels arrive as a prop rather than through the admin i18n context
 * because the volunteer's route has no admin shell around it.
 */

/**
 * The dictionary section this screen reads, passed in whole rather than read
 * from the admin i18n context — the volunteer's route has no admin shell
 * around it, and this component is the same component on both.
 *
 * `import type` only, so nothing of the English dictionary reaches the
 * client bundle.
 */
export type CheckinLabels = AdminDictionary["checkin"];

const RESULT_HOLD_MS = 1_600;
const SEARCH_DEBOUNCE_MS = 220;

export function DoorConsole({
  productId,
  token = null,
  initialStats,
  initialRows,
  tiers,
  labels: a,
  canAddWalkUps = true,
  initialCode = null,
}: {
  productId: string;
  /** Set when a volunteer is holding a door pass rather than a session. */
  token?: string | null;
  initialStats: DoorStats;
  initialRows: { rows: DoorRow[]; total: number };
  tiers: string[];
  labels: CheckinLabels;
  canAddWalkUps?: boolean;
  /** A code carried in by an old URL-shaped QR; admitted once, on mount. */
  initialCode?: string | null;
}) {
  const [tab, setTab] = useState<"scan" | "list" | "manual">("scan");
  const [result, setResult] = useState<CheckInState>({ status: "idle" });
  const [stats, setStats] = useState(initialStats);
  const [busy, setBusy] = useState(false);

  /*
   * Memoised because it is a dependency of every callback below and of the
   * list's search effect. A fresh object each render would re-run the search
   * on every keystroke's re-render as well as on the keystroke itself, which
   * at a door is two round trips per letter over venue wifi.
   */
  const scope = useMemo(() => ({ productId, token }), [productId, token]);

  /**
   * Held while a result is on screen so the camera doesn't read the next
   * person in the queue before the volunteer has looked up. Cleared on a
   * timer rather than by a tap: the whole point is that nobody has to tap.
   */
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current); }, []);

  const refreshStats = useCallback(async () => {
    const next = await doorStats(scope);
    if (next) setStats(next);
  }, [scope]);

  const show = useCallback(
    (state: CheckInState) => {
      setResult(state);
      signal(
        state.status === "checked_in"
          ? "ok"
          : state.status === "already_used"
            ? "warn"
            : "bad",
      );
      if (holdRef.current) clearTimeout(holdRef.current);
      holdRef.current = setTimeout(
        () => setResult({ status: "idle" }),
        RESULT_HOLD_MS,
      );
      void refreshStats();
    },
    [refreshStats],
  );

  const onCode = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        show(await admitByCode({ ...scope, code }));
      } finally {
        setBusy(false);
      }
    },
    [show, scope],
  );

  /*
   * A code that arrived in the URL, admitted once and only once.
   *
   * This is the compatibility path for every QR already sitting in a buyer's
   * inbox, which encodes a link rather than a bare code. The ref guard
   * matters: without it React's development double-invoke, and any later
   * re-render, would replay the admission — and the second attempt reports
   * "already used" over the top of the green screen, which is precisely the
   * message that makes a volunteer turn somebody away.
   */
  const claimedRef = useRef(false);
  useEffect(() => {
    if (!initialCode || claimedRef.current) return;
    claimedRef.current = true;
    void onCode(initialCode);
  }, [initialCode, onCode]);

  const percent =
    stats.issued > 0 ? Math.round((stats.checkedIn / stats.issued) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Counters. Deliberately the largest thing on the screen — "how many
          are in" is the question an organiser asks every few minutes and
          previously had no way to answer at all. */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <Counter value={stats.checkedIn} label={a.statIn} tone="in" />
          <Counter value={stats.remaining} label={a.statOut} />
          <Counter
            value={stats.capacity ?? stats.issued}
            label={stats.capacity === null ? a.statIssued : a.statCapacity}
            muted
          />
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={a.statIn}
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </Card>

      <SegmentedControl
        className="w-full"
        ariaLabel={a.title}
        value={tab}
        onChange={setTab}
        options={[
          { value: "scan", label: a.tabScan },
          { value: "list", label: a.tabList },
          { value: "manual", label: a.tabManual },
        ]}
      />

      {tab === "scan" ? (
        <Scanner
          onCode={onCode}
          paused={busy || result.status !== "idle"}
          labels={{
            starting: a.scanStarting,
            ready: a.scanReady,
            blocked: a.scanBlocked,
            blockedBody: a.scanBlockedBody,
          }}
        />
      ) : null}

      {tab === "manual" ? (
        <ManualForm labels={a} busy={busy} onCode={onCode} />
      ) : null}

      {/* The result sits below every tab, not just the scanner: admitting from
          the list has to say the same thing in the same place. */}
      <ResultCard state={result} labels={a} />

      {tab === "list" ? (
        <DoorList
          scope={scope}
          initial={initialRows}
          tiers={tiers}
          labels={a}
          canAddWalkUps={canAddWalkUps}
          onResult={show}
        />
      ) : null}
    </div>
  );
}

function Counter({
  value,
  label,
  tone,
  muted,
}: {
  value: number;
  label: string;
  tone?: "in";
  muted?: boolean;
}) {
  return (
    <div>
      <p
        className={`tabular text-3xl font-bold leading-none ${
          tone === "in"
            ? "text-emerald-600"
            : muted
              ? "text-ink-400"
              : "text-ink-900"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-500">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The answer                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Big type and hard colour, because this is read at arm's length in a doorway
 * by somebody who is also watching a queue. The three outcomes are green,
 * amber and red and never share a shape.
 */
function ResultCard({
  state,
  labels: a,
}: {
  state: CheckInState;
  labels: CheckinLabels;
}) {
  if (state.status === "idle") return null;

  const good = state.status === "checked_in";
  const warn = state.status === "already_used";

  const headline = good
    ? a.checkedIn
    : warn
      ? state.usedAt
        ? interpolate(a.alreadyUsedAt, {
            time: state.usedAt.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            }),
          })
        : a.alreadyUsed
      : state.status === "wrong_event"
        ? state.productTitle
          ? interpolate(a.wrongEvent, { event: state.productTitle })
          : a.wrongEventUnknown
        : state.status === "revoked"
          ? a.revoked
          : state.status === "not_released"
            ? a.notReleased
            : a.notFound;

  return (
    <Card
      aria-live="assertive"
      className={`animate-fade p-5 ${
        good
          ? "border-emerald-300 bg-emerald-50"
          : warn
            ? "border-amber-300 bg-amber-50"
            : "border-red-300 bg-red-50"
      }`}
    >
      <div className="flex items-start gap-3">
        {good ? (
          <BadgeCheck className="mt-0.5 size-9 shrink-0 text-emerald-600" />
        ) : warn ? (
          <CircleAlert className="mt-0.5 size-9 shrink-0 text-amber-600" />
        ) : (
          <TicketX className="mt-0.5 size-9 shrink-0 text-red-600" />
        )}
        <div className="min-w-0">
          <p
            className={`text-lg font-bold ${
              good
                ? "text-emerald-900"
                : warn
                  ? "text-amber-900"
                  : "text-red-900"
            }`}
          >
            {headline}
          </p>
          {"attendee" in state ? (
            <p className="mt-1 truncate text-sm text-ink-700">
              {[state.attendee, state.tier].filter(Boolean).join(" · ")}
              {state.checkedInBy ? (
                <span className="text-ink-500">
                  {" "}
                  {interpolate(a.byWhom, { name: state.checkedInBy })}
                </span>
              ) : null}
              <span className="mt-0.5 block font-mono text-xs text-ink-500">
                {state.code}
              </span>
            </p>
          ) : "code" in state && state.code ? (
            <p className="mt-1 font-mono text-xs text-ink-500">{state.code}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Typing a code                                                              */
/* -------------------------------------------------------------------------- */

function ManualForm({
  labels: a,
  busy,
  onCode,
}: {
  labels: CheckinLabels;
  busy: boolean;
  onCode: (code: string) => void | Promise<void>;
}) {
  const [code, setCode] = useState("");

  return (
    <Card className="p-5">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!code.trim()) return;
          await onCode(code);
          setCode("");
        }}
        className="space-y-4"
      >
        <Field label={a.codeLabel} htmlFor="code" hint={a.scanHint}>
          <Input
            id="code"
            name="code"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            // A code is base32 with a dash. A numeric keypad is wrong and a
            // full keyboard with autocorrect is worse — iOS will happily
            // "fix" a ticket code into a dictionary word.
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABC12-DE345"
            className="font-mono text-lg uppercase"
          />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {a.submit}
        </Button>
      </form>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  The list                                                                   */
/* -------------------------------------------------------------------------- */

function DoorList({
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

function GuestRow({
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
function WalkUpForm({
  scope,
  labels: a,
  onDone,
  onCancel,
}: {
  scope: { productId: string; token: string | null };
  labels: CheckinLabels;
  onDone: (state: CheckInState) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-ink-900">{a.addGuest}</p>
      <p className="mt-1 text-xs text-ink-500">{a.addGuestBody}</p>

      <form
        className="mt-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim() || busy) return;
          setBusy(true);
          try {
            onDone(await addWalkUp({ ...scope, name, email }));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={a.guestName} htmlFor="walkup-name">
          <Input
            id="walkup-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            autoComplete="off"
          />
        </Field>
        <Field label={a.guestEmail} htmlFor="walkup-email">
          <Input
            id="walkup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {a.addAndAdmit}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {a.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
