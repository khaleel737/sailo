"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  admitByCode,
  doorStats,
} from "@/lib/actions/tickets";
import type { CheckInState, DoorVerdict } from "@sailo/commerce/ticketing";
import type { DoorRow, DoorStats } from "@sailo/commerce/ticketing";
import type { AdminDictionary } from "@sailo/i18n/admin/en";
import { Card } from "@sailo/design-system/web";
import { SegmentedControl } from "@sailo/design-system/web";
import { Scanner } from "./scanner";
import { signal } from "./feedback";
import { Counter } from "./door/counter";
import { ResultCard } from "./door/result-card";
import { ManualForm } from "./door/manual-form";
import { DoorList } from "./door/door-list";
import { RESULT_HOLD_MS } from "./door/labels";

/**
 * One door, whoever is standing at it.
 *
 * The owner reaches this through `/admin/checkin/[productId]` and a volunteer
 * through `/door/[token]`; the only difference is the `token` prop, which
 * every action carries back so the server can decide what that caller may
 * touch. Labels arrive as a prop rather than through the admin i18n context
 * because the volunteer's route has no admin shell around it.
 *
 * The five pieces it draws are in `./door/` — this file is the console: the camera, the scan
 * queue, and what to do with a verdict.
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
  /*
   * Null is idle now, rather than a ticket-shaped `{ status: "idle" }`.
   *
   * The console holds a verdict that may be a ticket *or* a membership, and
   * "no scan yet" is a state neither of them owns — expressing it as an idle
   * ticket would have made every member render read a ticket field first.
   */
  const [verdict, setVerdict] = useState<DoorVerdict | null>(null);
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
    (next: DoorVerdict) => {
      setVerdict(next);
      /*
       * The haptic follows the card's colour, including the one place the two
       * credentials disagree: a member scanned twice is an ordinary admission
       * and buzzes "ok", where a ticket scanned twice buzzes "warn" because
       * somebody is trying to get a second person in on one admission.
       */
      signal(
        next.kind === "member"
          ? next.result.status === "checked_in" ||
            next.result.status === "already_in"
            ? "ok"
            : "bad"
          : next.result.status === "checked_in"
            ? "ok"
            : next.result.status === "already_used"
              ? "warn"
              : "bad",
      );
      if (holdRef.current) clearTimeout(holdRef.current);
      holdRef.current = setTimeout(
        () => setVerdict(null),
        RESULT_HOLD_MS,
      );
      void refreshStats();
    },
    [refreshStats],
  );

  /*
   * The guest list only ever produces tickets — it is a list of admissions,
   * and a walk-up is a ticket minted on the spot. Adapting here rather than
   * widening `DoorList`'s prop keeps it honest about what it can return, and
   * puts the one line that bridges the two credentials exactly where they
   * meet.
   */
  const showTicket = useCallback(
    (state: CheckInState) => show({ kind: "ticket", result: state }),
    [show],
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
          paused={busy || verdict !== null}
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
      <ResultCard verdict={verdict} labels={a} />

      {tab === "list" ? (
        <DoorList
          scope={scope}
          initial={initialRows}
          tiers={tiers}
          labels={a}
          canAddWalkUps={canAddWalkUps}
          onResult={showTicket}
        />
      ) : null}
    </div>
  );
}
