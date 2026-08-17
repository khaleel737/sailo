import { describe, expect, it } from "vitest";
import { HANDLE_MAX, validateHandleFormat } from "@sailo/core/handle";
import { tombstoneHandle, tombstoneEmail } from "./tombstone";

/**
 * What replaces a seller's identity when their row has to outlive them.
 *
 * Both of these strings are written into live columns whose constraints are declared in
 * another package, and neither constraint is checkable by the compiler:
 *
 * - the handle goes into `shops.handle`, which `validateHandleFormat` polices and which
 *   has a unique index. A tombstone that fails validation cannot be *entered* by a
 *   seller, but it can absolutely be written by this code — and the failure surfaces
 *   later, as a shop nobody can edit or a UNIQUE violation mid-deletion.
 * - the email goes into `user.email`, and its whole job is to be unreachable.
 *
 * So the real assertions here run the tombstone through the actual validator rather
 * than through a restatement of what the validator is believed to do.
 */

const SHOP_ID = "0191c2f4-6a3b-7c1d-9e5f-2b8a4d6c1e30";
const USER_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("tombstoneHandle", () => {
  /*
   * The test that matters, and the one a restatement would get wrong. `HANDLE_MAX` is
   * 32 and a trailing dash is rejected, which is why the uuid's hyphens come out and
   * the hex is cut to 24 — but that reasoning lives in a comment, and comments do not
   * fail builds.
   */
  it("is a handle the validator accepts", () => {
    expect(validateHandleFormat(tombstoneHandle(SHOP_ID))).toBeNull();
  });

  it("fits inside the column's limit", () => {
    expect(tombstoneHandle(SHOP_ID).length).toBeLessThanOrEqual(HANDLE_MAX);
  });

  it("does not end in a dash, whatever the uuid looked like", () => {
    // A uuid cut at 24 hex characters cannot end in a dash, but the slice is what
    // guarantees that and the slice is the thing somebody might adjust.
    for (const id of [SHOP_ID, USER_ID, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]) {
      expect(tombstoneHandle(id).endsWith("-")).toBe(false);
    }
  });

  it("says what it is, so a human reading the table is not confused", () => {
    expect(tombstoneHandle(SHOP_ID).startsWith("deleted-")).toBe(true);
  });

  /*
   * `shops.handle` is unique, so two deletions must not collide. Truncating to 24 hex
   * characters keeps 96 bits, which is the reason this is safe — and the reason a
   * future "shorten it a bit" is not free.
   */
  it("is distinct for distinct shops", () => {
    expect(tombstoneHandle(SHOP_ID)).not.toBe(tombstoneHandle(USER_ID));
  });

  /*
   * Every step of the deletion is written to be idempotent, because the alternative to
   * "a retry finishes the job" is "a crash halfway leaves an account that is neither
   * deleted nor usable". So the handle has to be stable for a given shop.
   */
  it("is the same on a second run, so a retry does not rename the tombstone", () => {
    expect(tombstoneHandle(SHOP_ID)).toBe(tombstoneHandle(SHOP_ID));
  });

  it("holds up for an id that is not uuid-shaped at all", () => {
    // Ids come from the database, but a caller passing something else must not produce
    // a handle the validator rejects.
    expect(validateHandleFormat(tombstoneHandle("short"))).toBeNull();
  });
});

describe("tombstoneEmail", () => {
  /*
   * `.invalid` is reserved by RFC 2606 precisely so it can never resolve. A real-looking
   * domain here would mean a deleted account's address could receive mail — or worse,
   * that somebody could register the domain and receive it.
   */
  it("uses a domain that can never receive mail", () => {
    expect(tombstoneEmail(USER_ID).endsWith("@sailo.invalid")).toBe(true);
  });

  it("is distinct per user, because the column is unique", () => {
    expect(tombstoneEmail(USER_ID)).not.toBe(tombstoneEmail(SHOP_ID));
  });

  it("is stable, so a retried deletion writes the same address", () => {
    expect(tombstoneEmail(USER_ID)).toBe(tombstoneEmail(USER_ID));
  });

  /*
   * THE GUARD THIS SHAPE FEEDS
   *
   * The deletion skips its farewell email when the current address already ends in
   * `@sailo.invalid` — that is how a re-run avoids mailing a tombstone. The check and
   * the constructor have to agree about the suffix, and they are in different files.
   */
  it("is recognisable by the suffix the deletion checks for", () => {
    expect(tombstoneEmail(USER_ID).endsWith("@sailo.invalid")).toBe(true);
  });

  it("is a plausible address rather than something a mailer would reject outright", () => {
    expect(tombstoneEmail(USER_ID)).toMatch(/^[^@\s]+@[^@\s]+$/);
  });
});
