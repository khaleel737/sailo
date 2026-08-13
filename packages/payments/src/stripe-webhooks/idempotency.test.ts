import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * At-least-once delivery, handled once.
 *
 * The claim is what makes "paid" idempotent, and the release is what keeps a
 * failed handler retryable. Both were untested: the seam moved into this
 * package without its cases, because in apps/web it had none.
 */

const { returning, onConflictDoNothing, values, insert, where, del } = vi.hoisted(() => {
  const returning = vi.fn();
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  const where = vi.fn();
  const del = vi.fn(() => ({ where }));
  return { returning, onConflictDoNothing, values, insert, where, del };
});

vi.mock("@sailo/db", () => ({ getDb: () => ({ insert, delete: del }) }));

const { claimEvent, releaseEvent } = await import("./idempotency");

const event = { id: "evt_1", type: "checkout.session.completed" } as Stripe.Event;

beforeEach(() => {
  returning.mockReset();
  onConflictDoNothing.mockClear();
  values.mockClear();
  insert.mockClear();
  where.mockClear();
  del.mockClear();
});

describe("claimEvent", () => {
  it("claims an event the first time it arrives", () => {
    returning.mockResolvedValue([{ id: "evt_1" }]);
    return expect(claimEvent(event)).resolves.toBe(true);
  });

  it("refuses the replay, because the empty result is the signal", async () => {
    /*
     * `onConflictDoNothing` returns no rows precisely when the id is already
     * recorded. That — not an error, not a lookup — is how a redelivery is
     * told apart from a first delivery, so a handler runs once however many
     * times Stripe sends it.
     */
    returning.mockResolvedValue([]);
    await expect(claimEvent(event)).resolves.toBe(false);
  });

  it("records the id and type, and conflicts on the id", async () => {
    returning.mockResolvedValue([{ id: "evt_1" }]);
    await claimEvent(event);

    expect(values).toHaveBeenCalledWith({ id: "evt_1", type: "checkout.session.completed" });
    // Conflicting on anything else would let a second event with the same
    // type claim the first one's slot.
    expect(onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
  });
});

describe("releaseEvent", () => {
  it("deletes the claim so Stripe's retry can have another go", async () => {
    // Without this, a handler that threw would leave its own claim behind and
    // every retry would be swallowed as a replay — the event lost for good.
    where.mockResolvedValue(undefined);
    await releaseEvent("evt_1");

    expect(del).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });
});
