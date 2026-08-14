/**
 * The door's memory.
 *
 * A venue is the worst network environment this app will ever run in: concrete,
 * steel, four hundred people with their phones out, and a queue down the street.
 * The scanner therefore cannot ask the server whether to let somebody in. It has
 * to answer by itself, in front of the person, and settle up afterwards.
 *
 * So this module owns three things that are usually one:
 *
 *   1. **The roster** — a snapshot of the event's tickets, taken while there was
 *      still signal. It is what lets an offline phone tell a real ticket from an
 *      invented one, and a first scan from a second one.
 *   2. **The queue** — every admission and undo this phone has decided but not
 *      yet told the server about, held durably so that a kill loses nothing.
 *   3. **The reconciliation** — replaying that queue when signal returns, with a
 *      client-generated idempotency key per operation so a replay admits exactly
 *      once no matter how many times it is retried.
 *
 * THE ONE RULE
 *
 * **An admission is never dropped.** Not on a full queue, not after a hundred
 * failed retries, not on a shape this build does not understand. Every other
 * consideration here — speed, memory, battery — loses to that one, because the
 * failure it prevents is a person who paid being turned away at a door, and the
 * failure it costs is a row syncing a few seconds later than it might have.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No React, no React Native, no Expo, no camera and no storage engine. This is
 * the decision-making half, kept pure so it can be reasoned about and tested
 * without a device in the loop. The two things it genuinely cannot do itself —
 * durable bytes and a network call — arrive as ports (`ScanStore`,
 * `ScanTransport`), and the screens supply them.
 *
 * @see docs/mobile/A10-checkin-scanner.md
 */

/* -------------------------------------------------------------------------- */
/*  The vocabulary                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the door decided about one code.
 *
 * These names mirror `CheckInState` in `@sailo/commerce` exactly, so that a
 * server answer can be stored in this field without a translation table in
 * between — a mapping is a place for the two vocabularies to drift, and the one
 * that matters here (`already_used`) is the one a careless mapping folds into an
 * error.
 *
 * They are re-declared rather than imported because `@sailo/commerce` is
 * `server-only`: it pulls `@sailo/db` and, through it, `pg`, which Metro will
 * follow all the way down before failing to bundle it. Keeping the union here
 * costs a duplicated list of six strings and keeps Postgres out of the app.
 *
 * `already_used` is **not an error**. Somebody stepping out for a cigarette and
 * coming back is the single most common thing that happens at a door after a
 * clean admission, and a screen that renders it in red teaches the operator to
 * ignore red.
 */
export type AdmitOutcome =
  | "checked_in"
  | "already_used"
  | "wrong_event"
  | "revoked"
  | "not_released"
  | "not_found";

/**
 * One ticket, as the phone remembers it.
 *
 * `admitted` is the state at the moment the roster was taken — a ticket burned
 * an hour ago by the other volunteer's phone. The queue tracks what *this* phone
 * has done since separately, because the two have to be told apart when the
 * roster is refreshed underneath a queue that has not drained yet.
 */
export type RosterEntry = {
  ticketId: string;
  /** Normalized. The raw printed form is never the lookup key. */
  code: string;
  attendee: string | null;
  tier: string | null;
  admitted: boolean;
};

/** The roster as it arrives, before it is indexed for lookup. */
export type Roster = {
  eventId: string;
  entries: RosterEntry[];
  /** When this snapshot was taken, so a screen can say how stale it is. */
  takenAt: number;
};

/**
 * An operation this phone has decided and the server has not yet been told.
 *
 * `id` is the idempotency key. It is generated once, when the operator scans,
 * and it never changes for the life of the row — that is the entire mechanism by
 * which a replay is safe. Re-generating it on retry, which is the obvious thing
 * to do if you think of it as a request id rather than as an operation id, turns
 * one admission into as many rows as there were attempts.
 */
export type QueuedOp = {
  id: string;
  kind: "admit" | "undo";
  ticketId: string;
  /** Carried for the operator-facing log; the server matches on `ticketId`. */
  code: string;
  at: number;
  /** Retries so far. Surfaced so a stuck queue is visible rather than silent. */
  attempts: number;
};

/**
 * What the operator sees, immediately.
 *
 * `pending` is the honest part: offline, `checked_in` means "this phone admitted
 * them and will tell the server later", which is a different claim from the same
 * word after a drain. The screen renders the difference — a queued tick is not a
 * confirmed tick — because an operator who cannot tell them apart has no way to
 * know whether walking out of range just lost the last twenty admissions.
 */
export type ScanVerdict = {
  outcome: AdmitOutcome;
  pending: boolean;
  code: string;
  attendee: string | null;
  tier: string | null;
  /** The queued row, when this scan produced one that `undo` can take back. */
  opId: string | null;
};

/* -------------------------------------------------------------------------- */
/*  The ports                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Durable bytes.
 *
 * A deliberately tiny surface — one string in, one string out — so that whatever
 * the app ends up installing can satisfy it: AsyncStorage, expo-sqlite's
 * key-value store, or a file. The queue is small (a busy door is a few hundred
 * rows of about a hundred bytes) and is always written whole, so nothing here
 * needs a transaction or a cursor.
 */
export type ScanStore = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

/**
 * What the server said about one operation.
 *
 * `replayed` is A03's, and it is the reason the key exists at all. The claim
 * itself is already safe without one — `admitOnce` is a conditional UPDATE on
 * `status = 'valid'`, so a second delivery of the same scan has never admitted
 * anybody twice. What the key buys is the *answer*: a scan the venue's wifi ate
 * and this queue sent again comes back `checked_in` with `replayed: true`,
 * rather than the `already_used` it would otherwise get, which reads to the
 * volunteer holding the phone as a refusal of a guest who is in fact inside.
 *
 * The server's window is a day (`IDEMPOTENCY_WINDOW_SECONDS`), and it degrades
 * honestly: with Redis cold the admit still runs and the worst case is the
 * older, blunter answer. Nobody is admitted twice either way.
 */
export type TransportAnswer = {
  outcome: AdmitOutcome;
  replayed: boolean;
};

/**
 * One operation, sent to the server.
 *
 * Resolves with the server's answer, which **wins** over whatever this phone
 * decided offline. Rejects for anything that is not an answer — no signal, a
 * 500, a timeout — and a rejection means "ask again later", never "this person
 * does not get in".
 *
 * The screens implement this over `tickets.admit`, which matches on the code and
 * takes `idempotencyKey`, and `tickets.undoAdmission`, which takes the ticket id
 * and no key — a volunteer tapping undo is looking at the row, not replaying a
 * queued request.
 */
export type ScanTransport = (op: QueuedOp) => Promise<TransportAnswer>;

/** Everything the queue keeps across a kill. */
type Persisted = {
  /** Bumped when the shape changes, so an old queue is discarded, not misread. */
  version: 1;
  eventId: string;
  ops: QueuedOp[];
  /** Ticket ids this phone has admitted since the roster was taken. */
  admitted: string[];
};

const VERSION = 1;

/* -------------------------------------------------------------------------- */
/*  Reading a code                                                             */
/* -------------------------------------------------------------------------- */

/**
 * What the door sees, however it arrived, folded to what was printed.
 *
 * **This is a copy of `normalizeTicketCode` in `@sailo/commerce`, and it should
 * not stay one.** That function is the authority, its comment explicitly
 * anticipates this scanner calling it, and two implementations of a rule about
 * which characters are confusable is exactly the arrangement where one of them
 * quietly stops matching the other. It cannot be imported today because
 * `@sailo/commerce` is `server-only`; the fix is to move it to `@sailo/core`,
 * which this app already depends on, and delete this. See the note in the
 * hand-off at the bottom of this file.
 *
 * Until then the two must be changed together. The rules, in the order they
 * matter: a full URL yields its `code` parameter, because every ticket issued
 * before the in-app scanner existed carries a QR encoding
 * `/admin/checkin?code=…` and those are sitting in buyers' inboxes; then case,
 * punctuation and spacing go; then the four Crockford lookalikes fold — I and L
 * to 1, O to 0, U to V.
 */
export function normalizeCode(raw: string): string {
  let text = raw.trim();

  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).searchParams.get("code") ?? "";
    } catch {
      // Not a URL after all. Fall through: it will normalize to something that
      // matches no row, which is the right answer for a malformed scan.
    }
  }

  const cleaned = text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/I|L/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");

  return cleaned.length === 10
    ? `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`
    : cleaned;
}

/**
 * An idempotency key, generated on the device.
 *
 * `crypto.randomUUID` is not on Hermes and `expo-crypto` is not a dependency of
 * this app, so this composes one from the clock, a per-process counter and four
 * draws of `Math.random`. That is around ninety bits of entropy plus a strictly
 * increasing local component, which is not a security boundary and does not need
 * to be: the key is a dedupe token scoped to one shop's tickets, and the damage
 * a collision does is bounded by the server refusing the second operation as a
 * duplicate of the first.
 *
 * Injectable so that the day `expo-crypto` lands for something else, the wiring
 * can pass `randomUUID` and this stops being used without a change here.
 */
let sequence = 0;

export function newOperationId(): string {
  sequence += 1;
  const random = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0"),
  ).join("");
  return `${Date.now().toString(36)}-${sequence.toString(36)}-${random}`;
}

/* -------------------------------------------------------------------------- */
/*  The queue                                                                  */
/* -------------------------------------------------------------------------- */

export type ScanQueueOptions = {
  eventId: string;
  store: ScanStore;
  transport: ScanTransport;
  /** Defaults to `newOperationId`. Overridden in tests and by a real UUID. */
  newId?: () => string;
  /**
   * Called when the server's answer to a queued admission is not `checked_in`
   * — the reconciliation the operator needs to see. Never called for the happy
   * path, so a screen can treat every call as something to surface.
   */
  onSettled?: (op: QueuedOp, answer: TransportAnswer) => void;
  /**
   * How long to wait after a failed drain, in milliseconds, per attempt. The
   * last value repeats forever — a queue that has failed twenty times is a phone
   * in a basement, not a bug, and it must keep trying until it is carried
   * upstairs.
   */
  backoff?: readonly number[];
};

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** What a screen renders the queue's own state from. */
export type ScanQueueState = {
  /** Operations still owed to the server. */
  pending: number;
  /** Admitted, of the roster's total. Counts this phone's queue too. */
  admitted: number;
  total: number;
  /** True while a drain is in flight. */
  syncing: boolean;
  /**
   * Attempts made by the oldest stuck operation. Zero when the queue is empty
   * or healthy. A screen shows this rather than hiding a queue that is not
   * moving — a door that has silently stopped syncing looks exactly like a door
   * that is working.
   */
  stalledAttempts: number;
  rosterTakenAt: number | null;
};

export type ScanQueue = ReturnType<typeof createScanQueue>;

/**
 * Builds the queue for one event.
 *
 * Deliberately not a hook and not a singleton: the scanner is presented for one
 * event, does its job and is dismissed, and its queue's life is exactly that.
 * Making it a module-level singleton would leave one event's undrained
 * operations in memory while a second event's roster loaded over the top.
 */
export function createScanQueue(options: ScanQueueOptions) {
  const { eventId, store, transport } = options;
  const newId = options.newId ?? newOperationId;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const settled = options.onSettled;

  /** code → entry. Built once per roster, because scanning is the hot path. */
  let byCode = new Map<string, RosterEntry>();
  let byTicket = new Map<string, RosterEntry>();
  let takenAt: number | null = null;

  let ops: QueuedOp[] = [];
  /** Ticket ids this phone has admitted and the roster does not know about. */
  let admitted = new Set<string>();

  let syncing = false;
  /**
   * The operation currently on the wire, if any.
   *
   * Tracked because an operation that has been sent can no longer be taken back
   * by deleting it locally — see `undo`.
   */
  let inFlight: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const listeners = new Set<(state: ScanQueueState) => void>();

  /* ---------------------------------------------------------------------- */
  /*  Persistence                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Writes the whole queue.
   *
   * Whole rather than incremental on purpose. The queue is at most a few tens of
   * kilobytes, and a full overwrite is atomic in a way an append is not: there
   * is no half-written record to parse back on the next launch, and no
   * compaction step that could itself be interrupted. The cost is bounded and
   * the failure mode is eliminated, which is the right trade for the one file
   * that must survive a kill.
   */
  async function persist(): Promise<void> {
    const snapshot: Persisted = {
      version: VERSION,
      eventId,
      ops,
      admitted: [...admitted],
    };
    await store.write(JSON.stringify(snapshot));
  }

  /**
   * Reads a queue left by a previous run, if it belongs to this event.
   *
   * Everything about this is defensive. The stored string is bytes from a
   * previous version of this app that may have been killed mid-write, and the
   * only two acceptable outcomes are "a queue" and "an empty queue" — a throw
   * here happens on launch, before the operator has done anything, and would
   * make the scanner look broken for a reason they cannot act on.
   *
   * A queue belonging to a *different* event is discarded rather than merged.
   * Replaying last night's undelivered admissions into tonight's door would
   * admit people to an event they are not attending.
   */
  async function restore(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await store.read();
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (parsed.version !== VERSION) return;
      if (parsed.eventId !== eventId) return;
      if (Array.isArray(parsed.ops)) {
        ops = parsed.ops.filter(isOp);
      }
      if (Array.isArray(parsed.admitted)) {
        admitted = new Set(parsed.admitted.filter((v) => typeof v === "string"));
      }
    } catch {
      // Corrupt or truncated. An empty queue is the only safe reading, and it
      // is what the fields already hold.
    }
  }

  /** Rejects rows this build cannot act on, rather than trusting the file. */
  function isOp(value: unknown): value is QueuedOp {
    if (typeof value !== "object" || value === null) return false;
    const op = value as Partial<QueuedOp>;
    return (
      typeof op.id === "string" &&
      (op.kind === "admit" || op.kind === "undo") &&
      typeof op.ticketId === "string" &&
      typeof op.code === "string" &&
      typeof op.at === "number" &&
      typeof op.attempts === "number"
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  State                                                                  */
  /* ---------------------------------------------------------------------- */

  function state(): ScanQueueState {
    let admittedCount = 0;
    for (const entry of byCode.values()) {
      if (entry.admitted || admitted.has(entry.ticketId)) admittedCount += 1;
    }
    return {
      pending: ops.length,
      admitted: admittedCount,
      total: byCode.size,
      syncing,
      stalledAttempts: ops[0]?.attempts ?? 0,
      rosterTakenAt: takenAt,
    };
  }

  function announce(): void {
    const next = state();
    for (const listener of listeners) listener(next);
  }

  /* ---------------------------------------------------------------------- */
  /*  Scanning                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * The decision, as a pure function of what this phone knows.
   *
   * Split out from `scan` and free of I/O so that the operator's feedback — the
   * haptic, the colour, the name — can be produced the instant the camera
   * decodes, well inside the 300ms budget the work order sets. The durable write
   * that follows it is what takes time, and it takes it *after* the person has
   * been waved through.
   *
   * Note what this cannot answer offline and does not pretend to: `revoked` and
   * `not_released` both depend on state the roster does not carry, so a ticket
   * that was refunded after the snapshot reads as valid here and is corrected by
   * the server on drain. That is the right way round — the alternative is
   * turning away a paying guest on stale data.
   */
  function decide(raw: string): ScanVerdict {
    const code = normalizeCode(raw);
    const entry = byCode.get(code);

    if (!entry) {
      return {
        outcome: "not_found",
        pending: false,
        code,
        attendee: null,
        tier: null,
        opId: null,
      };
    }

    const already = entry.admitted || admitted.has(entry.ticketId);
    return {
      outcome: already ? "already_used" : "checked_in",
      pending: !already,
      code,
      attendee: entry.attendee,
      tier: entry.tier,
      opId: null,
    };
  }

  /**
   * Admit whoever this code belongs to, and remember that we did.
   *
   * Ordering is the whole point: decide, mutate memory, *then* persist, then
   * return. The operator's answer is fixed before the disk is touched, so a slow
   * write cannot slow the door down; and the write completes before this
   * resolves, so a screen that awaits it knows the admission is on disk. A kill
   * in between loses at most the operation currently being written, which is the
   * smallest window this can have without giving up durability entirely.
   *
   * A repeat scan of a code this phone already admitted produces no second
   * operation. Two taps on one ticket is one admission, and the second one is an
   * `already_used` answer rather than a queued no-op the server has to dedupe.
   */
  async function scan(raw: string): Promise<ScanVerdict> {
    const verdict = decide(raw);
    if (verdict.outcome !== "checked_in") return verdict;

    const entry = byCode.get(verdict.code);
    if (!entry) return verdict;

    const op: QueuedOp = {
      id: newId(),
      kind: "admit",
      ticketId: entry.ticketId,
      code: entry.code,
      at: Date.now(),
      attempts: 0,
    };

    admitted.add(entry.ticketId);
    ops = [...ops, op];

    await persist();
    announce();
    schedule(0);

    return { ...verdict, opId: op.id };
  }

  /**
   * Take an admission back.
   *
   * Two cases, and they are genuinely different. An admission still sitting in
   * the queue has never left the phone, so undoing it means deleting it —
   * annihilating the pair locally rather than sending an admit and an undo the
   * server has to reconcile. One that has already drained, or is on the wire
   * right now, needs the server told, so it becomes an `undo` operation with its
   * own key, which is itself queued and therefore works with no signal.
   *
   * Fast in both cases, because the mis-scan it fixes happened ten seconds ago
   * with a queue of people watching.
   */
  async function undo(ticketId: string): Promise<void> {
    const queued = ops.find((op) => op.kind === "admit" && op.ticketId === ticketId);

    /*
     * An operation already on the wire cannot be annihilated. The server may
     * have committed it a millisecond ago and simply not answered yet, and
     * deleting the local row would leave that admission standing with nothing
     * left to undo it — the guest is admitted, the operator was told otherwise,
     * and the two never reconcile. So an in-flight admit is undone the honest
     * way, with a real `undo` operation behind it.
     */
    if (queued && queued.id !== inFlight) {
      ops = ops.filter((op) => op.id !== queued.id);
    } else {
      ops = [
        ...ops,
        {
          id: newId(),
          kind: "undo",
          ticketId,
          code: byTicket.get(ticketId)?.code ?? "",
          at: Date.now(),
          attempts: 0,
        },
      ];
    }

    admitted.delete(ticketId);
    const entry = byTicket.get(ticketId);
    // The roster's own `admitted` flag has to move too, or a ticket admitted
    // before this phone took its snapshot would read as still-admitted the
    // moment the undo is queued and the operator would undo it twice.
    if (entry) entry.admitted = false;

    await persist();
    announce();
    schedule(0);
  }

  /* ---------------------------------------------------------------------- */
  /*  Draining                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Send what we owe, oldest first.
   *
   * Strictly sequential rather than in parallel. An admit and the undo that
   * cancels it must reach the server in the order the operator performed them,
   * and a burst of two hundred parallel requests over a door's reconnecting
   * hotspot is also the reliable way to have most of them time out at once.
   *
   * A failure stops the run rather than skipping to the next operation, for the
   * same ordering reason, and schedules a retry. A refusal is different from a
   * failure: the server answering `not_found` is an answer, the operation is
   * settled, and it comes off the queue. Only an exception — no signal, a 500 —
   * leaves it there.
   */
  async function drain(): Promise<void> {
    if (syncing || closed || ops.length === 0) return;
    syncing = true;
    announce();

    let failed = false;

    try {
      while (ops.length > 0) {
        // Re-read rather than testing in the loop condition: `close()` can land
        // while an operation is in flight above, and the point of the check is
        // to notice that it did.
        if (closed) break;

        const op = ops[0];
        if (!op) break;

        try {
          inFlight = op.id;
          const answer = await transport(op);

          // Settled, whatever the answer was. The server is the authority on
          // `revoked` and `not_released`, which this phone could not have known
          // offline, and the reconciliation is simply that its answer replaces
          // the local guess in the roster.
          const entry = byTicket.get(op.ticketId);
          if (entry) {
            entry.admitted =
              op.kind === "admit"
                ? answer.outcome === "checked_in" ||
                  answer.outcome === "already_used"
                : false;
          }

          /*
           * Tell the screen when the server disagreed with what the operator was
           * shown. Offline, a refunded ticket and a code from a different night
           * both read as `checked_in` here — the roster cannot know — and the
           * correction arrives minutes later, after the guest has walked in.
           * Silently swallowing it would leave the door's own count disagreeing
           * with the seller's, with nothing on screen having ever said so.
           */
          if (op.kind === "admit" && answer.outcome !== "checked_in") {
            settled?.(op, answer);
          }
          admitted.delete(op.ticketId);
          /*
           * By identity, never by position. `undo` can remove a *different*
           * operation from this array while the one above is on the wire, and a
           * `slice(1)` would then drop whichever row had shuffled into the head
           * — an admission discarded without ever being sent, which is the one
           * outcome this file exists to prevent.
           */
          ops = ops.filter((queued) => queued.id !== op.id);
          await persist();
          announce();
        } catch {
          // Not an answer. Leave it at the head of the queue and stop.
          op.attempts += 1;
          failed = true;
          await persist();
          break;
        } finally {
          inFlight = null;
        }
      }
    } finally {
      syncing = false;
      announce();
    }

    if (failed) schedule(delayFor(ops[0]?.attempts ?? 1));
  }

  /** The wait after `attempts` failures, clamped to the last step. */
  function delayFor(attempts: number): number {
    const index = Math.min(Math.max(attempts, 1), backoff.length) - 1;
    return backoff[index] ?? DEFAULT_BACKOFF[DEFAULT_BACKOFF.length - 1] ?? 30_000;
  }

  /**
   * One pending drain at a time.
   *
   * Every path that adds work calls this, so without the guard a busy door would
   * stack one timer per scan and then fire two hundred overlapping drains the
   * moment signal returned.
   */
  function schedule(delay: number): void {
    if (closed || timer !== null || ops.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  /* ---------------------------------------------------------------------- */
  /*  Lifecycle                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Replace the roster, keeping this phone's undrained work.
   *
   * Called on a refresh, and the merge is the delicate part: the server's
   * snapshot is authoritative about everyone else's admissions, and this phone's
   * queue is authoritative about its own. Dropping `admitted` here would make
   * every queued scan re-scannable and let one ticket be admitted twice while
   * the queue that already holds it waits for signal.
   */
  function setRoster(roster: Roster): void {
    byCode = new Map(roster.entries.map((entry) => [entry.code, entry]));
    byTicket = new Map(roster.entries.map((entry) => [entry.ticketId, entry]));
    takenAt = roster.takenAt;
    announce();
  }

  return {
    /**
     * Load anything a previous run left behind, then adopt a roster.
     *
     * In this order, and both before the camera starts: a queue restored *after*
     * the first scan of the night would append to an empty array and the
     * previous run's admissions would be written over rather than sent.
     */
    async open(roster: Roster): Promise<void> {
      await restore();
      setRoster(roster);
      schedule(0);
    },

    setRoster,
    decide,
    scan,
    undo,

    /** Ask for a drain now — on reconnect, or on returning to the foreground. */
    sync(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      void drain();
    },

    /** Everything still owed, oldest first, for the pending list on screen. */
    outstanding(): readonly QueuedOp[] {
      return ops;
    },

    getState: state,

    subscribe(listener: (next: ScanQueueState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /**
     * Stop the timers. **Does not discard the queue** — it is on disk, and the
     * next `open` for this event picks it up. Dismissing the scanner with three
     * unsynced admissions must not be the thing that loses them.
     */
    close(): void {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      listeners.clear();
    },
  };
}

/**
 * HAND-OFF — the four packages this still needs
 *
 * The server half landed with A03 and this file is written against it, not
 * against a guess: `tickets.admit` takes `{ code, productId, idempotencyKey }`
 * and answers with `replayed`, `tickets.undoAdmission` takes a ticket id, and
 * `events.door` returns the stats and rows the roster is built from.
 *
 * What is left is native, and all of it lives in `apps/mobile/package.json` and
 * `app.json`, both outside this work order's `Owns` paths:
 *
 *   - **A storage engine.** `ScanStore` wants an adapter over AsyncStorage,
 *     expo-sqlite or expo-file-system. Until one exists the queue is durable in
 *     principle and in-memory in practice, which is the one property it cannot
 *     be allowed to ship without. `expo-secure-store` is installed but is the
 *     wrong tool — it is the keychain, size-limited and slow.
 *   - **`expo-camera`**, plus a `plugins` entry in `app.json` so Android asks
 *     for CAMERA. The iOS `NSCameraUsageDescription` is already written.
 *   - **`expo-haptics`**, for the three distinct outcomes the work order wants
 *     a dark venue to be able to feel.
 *   - **`expo-keep-awake`**, so the screen does not sleep mid-queue.
 *
 * One string is also wrong rather than missing: `a.checkin.scanBlockedBody`
 * reads "Allow camera access in your browser", which is the web door's wording.
 * It needs a native variant from whoever owns `packages/i18n/src/admin/*`.
 *
 * And `normalizeCode` above is a copy of `normalizeTicketCode` in
 * `@sailo/commerce`. Move that to `@sailo/core` — already a dependency here —
 * and delete the copy.
 */
