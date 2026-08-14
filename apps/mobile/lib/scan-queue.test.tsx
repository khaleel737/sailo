import {
  createScanQueue,
  normalizeCode,
  type QueuedOp,
  type Roster,
  type ScanStore,
  type TransportAnswer,
} from "./scan-queue";

/**
 * The offline queue, held to the one promise it makes.
 *
 * The work order's acceptance test is "200 scans taken in airplane mode all
 * sync on reconnect, admitting each exactly once", and that is not a property
 * you can eyeball from the code — it falls out of the interaction between a
 * durable write, a retry loop and an undo that can land at any point in either.
 * So it is pinned here, along with the two orderings that were wrong in the
 * first draft of the file and would each have silently dropped an admission.
 *
 * Everything is driven through the two ports. `ScanStore` becomes a string in a
 * variable — which is also how the kill tests work, since a queue rebuilt over
 * the same string is exactly what a relaunch is — and `ScanTransport` becomes a
 * function that counts what it was asked to do. No device, no network, no fake
 * timers except where a backoff is the thing under test.
 */

/** A store that is just a variable, so a "relaunch" is a second `createScanQueue`. */
function memoryStore(): ScanStore & { value: string | null } {
  return {
    value: null,
    async read() {
      return this.value;
    },
    async write(next: string) {
      this.value = next;
    },
  };
}

function roster(count: number): Roster {
  return {
    eventId: "event-1",
    takenAt: 1_700_000_000_000,
    entries: Array.from({ length: count }, (_, i) => ({
      ticketId: `ticket-${i}`,
      code: normalizeCode(`AAAAA${String(i).padStart(5, "0")}`),
      attendee: `Guest ${i}`,
      tier: null,
      admitted: false,
    })),
  };
}

const ADMITTED: TransportAnswer = { outcome: "checked_in", replayed: false };

/** A transport with no signal behind it: every send rejects, nothing settles. */
const offline = async (): Promise<TransportAnswer> => {
  throw new Error("no signal");
};

/** Ids that are stable across a run, so a replay is recognisable in a log. */
function countingIds(): () => string {
  let n = 0;
  return () => `op-${(n += 1)}`;
}

describe("the offline queue", () => {
  it("admits 200 offline scans exactly once when the signal comes back", async () => {
    const store = memoryStore();
    const sent: QueuedOp[] = [];
    let online = false;

    const queue = createScanQueue({
      eventId: "event-1",
      store,
      newId: countingIds(),
      transport: async (op) => {
        if (!online) throw new Error("no signal");
        sent.push(op);
        return ADMITTED;
      },
    });

    await queue.open(roster(200));

    // The venue, with the wifi down.
    for (let i = 0; i < 200; i++) {
      const verdict = await queue.scan(`AAAAA${String(i).padStart(5, "0")}`);
      expect(verdict.outcome).toBe("checked_in");
      // Offline, an admission is honest about being only on this phone.
      expect(verdict.pending).toBe(true);
    }

    expect(queue.getState().pending).toBe(200);
    expect(queue.getState().admitted).toBe(200);
    expect(sent).toHaveLength(0);

    // Somebody props the fire door open.
    online = true;
    queue.sync();
    await settle();

    expect(queue.getState().pending).toBe(0);
    expect(sent).toHaveLength(200);

    // Exactly once, per ticket and per key: 200 distinct tickets, 200 distinct
    // idempotency keys, and no ticket sent twice.
    expect(new Set(sent.map((op) => op.ticketId)).size).toBe(200);
    expect(new Set(sent.map((op) => op.id)).size).toBe(200);

    queue.close();
  });

  it("loses nothing when the app is killed with a full queue", async () => {
    const store = memoryStore();
    const first = createScanQueue({
      eventId: "event-1",
      store,
      transport: offline,
      newId: countingIds(),
    });
    await first.open(roster(10));
    for (let i = 0; i < 10; i++) {
      await first.scan(`AAAAA${String(i).padStart(5, "0")}`);
    }
    // The kill: no drain, no flush, nothing given a chance to tidy up.
    first.close();

    const sent: QueuedOp[] = [];
    const second = createScanQueue({
      eventId: "event-1",
      store,
      newId: countingIds(),
      transport: async (op) => {
        sent.push(op);
        return ADMITTED;
      },
    });
    await second.open(roster(10));

    expect(second.getState().pending).toBe(10);
    second.sync();
    await settle();
    expect(sent).toHaveLength(10);
    expect(second.getState().pending).toBe(0);

    second.close();
  });

  it("refuses a queue belonging to a different event", async () => {
    const store = memoryStore();
    const lastNight = createScanQueue({
      eventId: "event-1",
      store,
      transport: offline,
      newId: countingIds(),
    });
    await lastNight.open(roster(3));
    await lastNight.scan("AAAAA00000");
    lastNight.close();

    // Replaying last night's admissions into tonight's door would admit people
    // to an event they are not attending.
    const tonight = createScanQueue({
      eventId: "event-2",
      store,
      transport: offline,
      newId: countingIds(),
    });
    await tonight.open({ ...roster(3), eventId: "event-2" });
    expect(tonight.getState().pending).toBe(0);
    tonight.close();
  });

  it("treats a second scan of one wristband as already-in, not a second admission", async () => {
    const store = memoryStore();
    const queue = createScanQueue({
      eventId: "event-1",
      store,
      newId: countingIds(),
      transport: async () => ADMITTED,
    });
    await queue.open(roster(3));

    const first = await queue.scan("AAAAA00000");
    expect(first.outcome).toBe("checked_in");

    const second = await queue.scan("AAAAA00000");
    expect(second.outcome).toBe("already_used");
    // Already-admitted is an answer, not a queued no-op for the server to dedupe.
    expect(queue.outstanding()).toHaveLength(1);

    queue.close();
  });

  it("reads a code however it was printed, typed or encoded in a QR", () => {
    expect(normalizeCode("aaaaa-00000")).toBe("AAAAA-00000");
    expect(normalizeCode("  aaaaa 00000 ")).toBe("AAAAA-00000");
    // The four Crockford lookalikes fold to what was printed: I and L to 1,
    // O to 0, U to V — so a code read aloud at a door cannot become another.
    expect(normalizeCode("IL0OU00000")).toBe("1100V-00000");
    // Every ticket issued before the in-app scanner carries this shape.
    expect(normalizeCode("https://sailo.store/admin/checkin?code=AAAAA-00000")).toBe(
      "AAAAA-00000",
    );
    // A malformed URL is not a code, and must not throw at a door.
    expect(() => normalizeCode("https://")).not.toThrow();
  });

  describe("undo", () => {
    it("annihilates an admission that never left the phone", async () => {
      const store = memoryStore();
      const sent: QueuedOp[] = [];
      const queue = createScanQueue({
        eventId: "event-1",
        store,
        newId: countingIds(),
        transport: async (op) => {
          sent.push(op);
          return ADMITTED;
        },
      });
      await queue.open(roster(3));

      const verdict = await queue.scan("AAAAA00000");
      expect(verdict.outcome).toBe("checked_in");
      await queue.undo("ticket-0");

      // Nothing to tell the server: the pair cancelled locally.
      expect(queue.outstanding()).toHaveLength(0);
      expect(queue.getState().admitted).toBe(0);

      queue.sync();
      await settle();
      expect(sent).toHaveLength(0);

      // And the ticket is scannable again, because nobody was ever admitted.
      const again = await queue.scan("AAAAA00000");
      expect(again.outcome).toBe("checked_in");

      queue.close();
    });

    it("tells the server about an admission that already drained", async () => {
      const store = memoryStore();
      const sent: QueuedOp[] = [];
      const queue = createScanQueue({
        eventId: "event-1",
        store,
        newId: countingIds(),
        transport: async (op) => {
          sent.push(op);
          return ADMITTED;
        },
      });
      await queue.open(roster(3));

      await queue.scan("AAAAA00000");
      queue.sync();
      await settle();
      expect(sent).toHaveLength(1);

      await queue.undo("ticket-0");
      queue.sync();
      await settle();

      expect(sent).toHaveLength(2);
      expect(sent[1]?.kind).toBe("undo");
      expect(sent[1]?.ticketId).toBe("ticket-0");

      queue.close();
    });
  });

  /*
   * The two orderings below are regressions. Both were wrong in the first draft
   * of `scan-queue.ts`, both type-checked, linted and read correctly, and both
   * silently destroyed an admission — the one failure the file exists to
   * prevent. They are the reason this test file is worth its length.
   */
  describe("a drain racing an undo", () => {
    it("does not drop the neighbour of an operation that was undone mid-flight", async () => {
      const store = memoryStore();
      const sent: QueuedOp[] = [];
      const held: Array<() => void> = [];

      const queue = createScanQueue({
        eventId: "event-1",
        store,
        newId: countingIds(),
        transport: async (op) => {
          sent.push(op);
          // Hold the first operation open so an undo can land underneath it.
          if (sent.length === 1) {
            await new Promise<void>((resolve) => held.push(resolve));
          }
          return ADMITTED;
        },
      });
      await queue.open(roster(3));

      await queue.scan("AAAAA00000"); // ticket-0, will be in flight
      await queue.scan("AAAAA00001"); // ticket-1, the neighbour
      await queue.scan("AAAAA00002"); // ticket-2

      queue.sync();
      await settle();
      expect(sent).toHaveLength(1); // held

      // Undo a *different* ticket, which reorders the array under the drain.
      await queue.undo("ticket-1");
      for (const resume of held) resume();
      await settle();

      // ticket-2 must still have been sent. Removing the drained operation by
      // position rather than by id used to discard it here, unsent.
      const admitted = sent.filter((op) => op.kind === "admit").map((op) => op.ticketId);
      expect(admitted).toContain("ticket-0");
      expect(admitted).toContain("ticket-2");
      expect(queue.getState().pending).toBe(0);

      queue.close();
    });

    it("undoes an in-flight admission on the server rather than deleting it locally", async () => {
      const store = memoryStore();
      const sent: QueuedOp[] = [];
      const held: Array<() => void> = [];

      const queue = createScanQueue({
        eventId: "event-1",
        store,
        newId: countingIds(),
        transport: async (op) => {
          sent.push(op);
          if (sent.length === 1) {
            await new Promise<void>((resolve) => held.push(resolve));
          }
          return ADMITTED;
        },
      });
      await queue.open(roster(3));

      await queue.scan("AAAAA00000");
      queue.sync();
      await settle();
      expect(sent).toHaveLength(1); // ticket-0 is on the wire

      // The operator undoes the very operation being sent. The server may have
      // committed it a millisecond ago, so deleting it locally would leave that
      // admission standing with nothing left to reverse it.
      await queue.undo("ticket-0");
      for (const resume of held) resume();
      await settle();

      expect(sent.map((op) => op.kind)).toEqual(["admit", "undo"]);

      queue.close();
    });
  });

  it("keeps retrying a queue that cannot reach the server, and says it is stuck", async () => {
    jest.useFakeTimers();
    try {
      const store = memoryStore();
      let attempts = 0;
      const queue = createScanQueue({
        eventId: "event-1",
        store,
        newId: countingIds(),
        backoff: [10, 20],
        transport: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error("no signal");
          return ADMITTED;
        },
      });
      await queue.open(roster(1));
      await queue.scan("AAAAA00000");

      /*
       * `settle()` is a real `setTimeout`, so it would never resolve here.
       * Under fake timers the clock is the only thing that advances anything,
       * and `advanceTimersByTimeAsync` flushes the microtasks between ticks.
       */
      queue.sync();
      await jest.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      // A door that has silently stopped syncing looks like one that is working,
      // so the failure count is part of the state a screen renders.
      expect(queue.getState().stalledAttempts).toBe(1);

      await jest.advanceTimersByTimeAsync(10);
      expect(attempts).toBe(2);

      await jest.advanceTimersByTimeAsync(20);
      expect(attempts).toBe(3);
      expect(queue.getState().pending).toBe(0);

      queue.close();
    } finally {
      jest.useRealTimers();
    }
  });

  it("surfaces a server answer that disagrees with what the operator was shown", async () => {
    const store = memoryStore();
    const disagreements: string[] = [];

    const queue = createScanQueue({
      eventId: "event-1",
      store,
      newId: countingIds(),
      // Offline the roster cannot know a ticket was refunded after the snapshot.
      transport: async () => ({ outcome: "revoked", replayed: false }),
      onSettled: (op) => disagreements.push(op.ticketId),
    });
    await queue.open(roster(2));

    const verdict = await queue.scan("AAAAA00000");
    expect(verdict.outcome).toBe("checked_in"); // what the door was told

    queue.sync();
    await settle();

    expect(disagreements).toEqual(["ticket-0"]);
    // The server's answer wins, so the count corrects itself.
    expect(queue.getState().admitted).toBe(0);

    queue.close();
  });
});

/**
 * Let every already-resolved promise in the chain run.
 *
 * The queue drains through a `setTimeout(0)`, and each operation is its own
 * await, so a single `await Promise.resolve()` only advances it by one step. A
 * handful of macrotask turns is enough to run a queue of two hundred to
 * completion, and is stable in a way a fixed count of microtasks is not.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
