import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, readLimit, MAX_LIMIT, DEFAULT_LIMIT } from "./respond";

/**
 * Paging, and the two ways it goes wrong.
 *
 * A cursor that round-trips imprecisely silently skips or repeats rows, and a
 * cursor that is trusted without checking its shape reaches a `uuid` column as
 * arbitrary text — where Postgres raises rather than returning nothing, which
 * turns a malformed query string into a 500.
 */

describe("cursors", () => {
  it("round-trips exactly", () => {
    const cursor = {
      createdAt: new Date("2026-08-12T09:41:07.221Z"),
      id: "3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
    };
    const decoded = decodeCursor(encodeCursor(cursor));

    expect(decoded).not.toBe("invalid");
    expect(decoded).not.toBeNull();
    if (decoded && decoded !== "invalid") {
      // Milliseconds included: two orders placed in the same second are the
      // ordinary case on a busy shop, and a cursor truncated to seconds would
      // hand back one of them twice.
      expect(decoded.createdAt.toISOString()).toBe("2026-08-12T09:41:07.221Z");
      expect(decoded.id).toBe(cursor.id);
    }
  });

  it("treats an absent cursor as the first page", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("refuses anything it did not write", () => {
    for (const raw of [
      "not-base64-at-all!!",
      Buffer.from("no-separator", "utf8").toString("base64url"),
      Buffer.from("2026-08-12T09:41:07.221Z|", "utf8").toString("base64url"),
      Buffer.from("|3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8", "utf8").toString("base64url"),
      Buffer.from("not-a-date|3f8a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8", "utf8").toString(
        "base64url",
      ),
    ]) {
      expect(decodeCursor(raw), raw).toBe("invalid");
    }
  });

  it("refuses an id that is not a uuid", () => {
    /*
     * This one is not fussiness. The value is compared against a `uuid`
     * column, and Postgres raises on a malformed literal rather than matching
     * nothing — so without this check a hand-typed cursor is a 500 rather than
     * a 400.
     */
    const raw = Buffer.from(
      "2026-08-12T09:41:07.221Z|'; drop table orders; --",
      "utf8",
    ).toString("base64url");
    expect(decodeCursor(raw)).toBe("invalid");
  });
});

describe("readLimit", () => {
  const limitOf = (query: string) =>
    readLimit(new URL(`https://example.com/x?${query}`));

  it("defaults when absent or unreadable", () => {
    expect(limitOf("")).toBe(DEFAULT_LIMIT);
    expect(limitOf("limit=abc")).toBe(DEFAULT_LIMIT);
    expect(limitOf("limit=0")).toBe(DEFAULT_LIMIT);
    expect(limitOf("limit=-5")).toBe(DEFAULT_LIMIT);
  });

  it("clamps rather than refusing", () => {
    // A caller asking for a million gets a hundred, not an error: the request
    // is answerable, and refusing it teaches nobody anything.
    expect(limitOf("limit=1000000")).toBe(MAX_LIMIT);
    expect(limitOf(`limit=${MAX_LIMIT + 1}`)).toBe(MAX_LIMIT);
  });

  it("honours what it can", () => {
    expect(limitOf("limit=1")).toBe(1);
    expect(limitOf("limit=50")).toBe(50);
    expect(limitOf("limit=7.9")).toBe(7);
  });
});
