import { useCallback, useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { captureError } from "@sailo/observability";
import { api } from "./api";

/**
 * Scans that have happened, whether or not the server has heard about them.
 *
 * This is the feature, not a fallback around it. A venue has concrete walls and
 * a phone at a door has one bar of signal on a good night — a scanner that
 * needs the network to answer before it can say "in" is a scanner that stops
 * working at the exact moment two hundred people are queueing outside.
 *
 * So the door never waits on the network. A scan is accepted locally, answered
 * locally, written to the queue, and drained whenever there is a connection.
 * The server is the record; the queue is what makes the record eventually
 * correct without making the volunteer wait for it.
 *
 * WHAT MAKES THIS SAFE TO REPLAY
 *
 * Every queued scan carries an idempotency key minted when the code was read,
 * not when it was sent. `tickets.admit` dedupes on it for a day and answers a
 * replay with the *original* outcome — so a scan the venue's wifi ate comes
 * back `checked_in` rather than `already_used`, which would read to the
 * volunteer as the door refusing somebody it had already let in. Admitting
 * twice is the failure mode with an angry human attached, and the key is what
 * makes it impossible rather than unlikely.
 */

/**
 * The queue lives in the keychain rather than in memory or AsyncStorage.
 *
 * Memory loses everything to an app kill, and iOS kills a backgrounded camera
 * app readily. AsyncStorage would survive that but is world-readable to anything
 * with the device unlocked, and a queue entry is a door code — the thing that
 * gets somebody into a paid event.
 */
const QUEUE_KEY = "sailo_scan_queue";

/** Beyond this the queue is a leak, not a buffer. */
const MAX_QUEUED = 500;

export type QueuedScan = {
  /** Minted at read time, so a replay is the same scan and not a new one. */
  idempotencyKey: string;
  code: string;
  productId: string | null;
  /** When the volunteer actually scanned, for reconciling the door later. */
  scannedAt: string;
};

/** What the door tells the volunteer, before the server has an opinion. */
export type ScanOutcome =
  /** The server said yes, or the queue accepted it on the server's behalf. */
  | "admitted"
  /** This code has already been through the door. */
  | "already"
  /** No such ticket for this event. */
  | "invalid"
  /** Accepted locally and not yet confirmed — the offline case. */
  | "queued";

async function read(): Promise<QueuedScan[]> {
  try {
    const raw = await SecureStore.getItemAsync(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedScan[]) : [];
  } catch (error) {
    /*
     * A queue that will not parse is a queue that will never drain, and
     * refusing to scan because of it would take the door down over a storage
     * bug. Report it and carry on empty — the scans in it are lost, which is
     * bad, but a door that stops is worse.
     */
    captureError(error, { scope: "mobile:scan-queue:read" });
    return [];
  }
}

async function write(queue: QueuedScan[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
  } catch (error) {
    captureError(error, { scope: "mobile:scan-queue:write" });
  }
}

/** 32 hex characters. Not a UUID because nothing here needs one to be. */
export function newIdempotencyKey(): string {
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/**
 * The door, as a hook.
 *
 * `scan` answers immediately in every case — that is the contract the whole
 * screen is built on. It tries the server first because a confirmed answer is
 * better than an optimistic one and, on a working connection, is just as fast;
 * when that fails for any reason it queues and reports `queued`, which the
 * screen draws differently from a confirmed admission so a volunteer is never
 * told something was checked that has not been.
 */
export function useScanQueue(productId: string | null) {
  const [pending, setPending] = useState(0);
  const [draining, setDraining] = useState(false);
  // Guards the drain against itself: a reconnect and a manual retry arriving
  // together would otherwise send every queued scan twice. Harmless, because of
  // the idempotency key — but it is twice the requests over the connection that
  // was just established.
  const drainingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    setPending((await read()).length);
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const enqueue = useCallback(
    async (entry: QueuedScan) => {
      const queue = await read();
      queue.push(entry);
      await write(queue);
      setPending(queue.length);
    },
    [],
  );

  /**
   * Send everything the door is holding.
   *
   * Sequential rather than parallel, deliberately. A queue drains on the first
   * bar of signal a venue gets back, and firing two hundred requests into that
   * is how the connection dies again — and how the door's own next scan ends up
   * behind them.
   *
   * An entry is removed only once the server has answered about it. A failure
   * stops the drain rather than skipping the entry: whatever broke the first
   * one is almost certainly still true for the second, and the alternative is
   * two hundred failures logged in a row.
   */
  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setDraining(true);
    try {
      let queue = await read();
      while (queue.length > 0) {
        const entry = queue[0]!;
        try {
          await api.tickets.admit.mutate({
            code: entry.code,
            productId: entry.productId,
            idempotencyKey: entry.idempotencyKey,
          });
        } catch (error) {
          captureError(error, { scope: "mobile:scan-queue:drain" });
          break;
        }
        queue = queue.slice(1);
        await write(queue);
        setPending(queue.length);
      }
    } finally {
      drainingRef.current = false;
      setDraining(false);
    }
  }, []);

  const scan = useCallback(
    async (code: string): Promise<ScanOutcome> => {
      const entry: QueuedScan = {
        idempotencyKey: newIdempotencyKey(),
        code,
        productId,
        scannedAt: new Date().toISOString(),
      };

      try {
        const result = await api.tickets.admit.mutate({
          code: entry.code,
          productId: entry.productId,
          idempotencyKey: entry.idempotencyKey,
        });
        /*
         * `replayed` is not an outcome the volunteer needs. It says the server
         * had already answered this exact scan, which happens when the queue
         * beat the live request — and the honest thing to show is what the
         * original answer was, which is what the server returns.
         */
        if (result.status === "checked_in") return "admitted";
        if (result.status === "already_used") return "already";
        return "invalid";
      } catch (error) {
        /*
         * Every failure queues, including a 4xx. That is deliberate: this
         * cannot tell "the venue's wifi dropped" from "the server refused"
         * without inspecting an error shape that may itself be a network
         * failure, and the wrong guess in one direction turns away a paying
         * guest while the wrong guess in the other is a duplicate the
         * idempotency key already makes harmless.
         */
        captureError(error, { scope: "mobile:scan-queue:scan" });
        await enqueue(entry);
        return "queued";
      }
    },
    [productId, enqueue],
  );

  return { scan, drain, pending, draining, refreshCount };
}
