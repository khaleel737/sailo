import { describe, expect, it } from "vitest";
import { decodeCursor, decodeCursorOrTop, encodeCursor } from "./cursor";

/**
 * The cursor, and the check that only one of its two former copies had.
 *
 * These were two functions with the same name, the same encoder and different
 * decoders — the REST one validated the id's shape, the tRPC one did not. The
 * assertions below are written against the *stricter* behaviour, because the
 * loose one had a consequence: `olderThan` puts the id into a comparison against
 * a `uuid` column, and Postgres raises on a malformed uuid rather than returning
 * nothing. A hand-typed cursor was a 500 on the phone's `orders.list` and a
 * clean 400 on `GET /api/v1/orders`.
 */

const AT = new Date("2026-03-04T05:06:07.008Z");
const ID = "6f1d2b7e-0000-4000-8000-000000000001";

describe("round trip", () => {
  it("survives encode and decode unchanged", () => {
    expect(decodeCursor(encodeCursor({ createdAt: AT, id: ID }))).toEqual({
      createdAt: AT,
      id: ID,
    });
  });

  /*
   * Millisecond precision is the whole reason the id is in the cursor: an import
   * writes fifty rows in the same millisecond, and a cursor that lost the
   * fraction would either repeat that millisecond or skip the rest of it.
   */
  it("keeps the milliseconds", () => {
    const decoded = decodeCursor(encodeCursor({ createdAt: AT, id: ID }));
    expect(decoded).not.toBe("invalid");
    expect((decoded as { createdAt: Date }).createdAt.getMilliseconds()).toBe(8);
  });
});

describe("absent versus malformed", () => {
  it.each([null, undefined, ""])("treats %s as absent, not malformed", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });

  /*
   * The case that mattered. Each of these decodes to *something*, so a decoder
   * that only checked for the separator would hand the id straight into SQL.
   */
  it.each([
    ["a non-uuid id", `${AT.toISOString()}|not-a-uuid`],
    ["an id that is a SQL fragment", `${AT.toISOString()}|1' OR '1'='1`],
    ["an empty id", `${AT.toISOString()}|`],
    ["a missing separator", AT.toISOString()],
    ["an unparseable timestamp", `not-a-date|${ID}`],
  ])("refuses %s", (_label, payload) => {
    expect(decodeCursor(Buffer.from(payload, "utf8").toString("base64url"))).toBe(
      "invalid",
    );
  });

  it("refuses bytes that are not base64url at all", () => {
    expect(decodeCursor("!!!not base64!!!")).toBe("invalid");
  });

  /*
   * `split("|", 2)` rather than `split("|")`: an id carrying the separator must
   * not be able to present a third field. It is refused by shape either way,
   * which is the point — two independent reasons to reject it.
   */
  it("refuses an id carrying the separator", () => {
    const payload = `${AT.toISOString()}|${ID}|extra`;
    expect(decodeCursor(Buffer.from(payload, "utf8").toString("base64url"))).toBe(
      "invalid",
    );
  });
});

describe("decodeCursorOrTop", () => {
  /*
   * The explicit swallow, for a caller with nowhere to report it. This is what
   * the loose decoder did for everybody implicitly; here it is a choice with a
   * name.
   */
  it("starts at the top for a malformed cursor", () => {
    expect(decodeCursorOrTop("!!!")).toBeNull();
  });

  it("still reads a good one", () => {
    expect(decodeCursorOrTop(encodeCursor({ createdAt: AT, id: ID }))).toEqual({
      createdAt: AT,
      id: ID,
    });
  });
});
