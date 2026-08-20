import { describe, expect, it } from "vitest";
import {
  apiOk,
  rateHeaders,
  readLimit,
  retryAfterHeader,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from "./respond";

/*
 * The cursor codec is `@sailo/core/paging` and is tested there
 * (`packages/core/src/paging/cursor.test.ts`) — this file only re-exports it.
 * What is tested here is what this module owns: the limit clamp and the
 * rate-limit headers.
 */

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

describe("rate-limit headers", () => {
  /*
   * These are the only headers a client can use to slow down *before* it is
   * refused, so the shape matters more than it looks: a name a library does not
   * recognise is a header nobody reads.
   */
  it("names the budget in the un-prefixed spelling", () => {
    expect(rateHeaders({ limit: 240, remaining: 12, resetSeconds: 31 })).toEqual({
      "ratelimit-limit": "240",
      "ratelimit-remaining": "12",
      "ratelimit-reset": "31",
    });
  });

  it("reports an exhausted budget as zero rather than omitting it", () => {
    // `remaining: 0` and "no header" mean different things to a client, and the
    // one that means "stop" has to be said out loud.
    expect(rateHeaders({ limit: 240, remaining: 0, resetSeconds: 1 })["ratelimit-remaining"]).toBe(
      "0",
    );
  });

  it("gives retry-after in whole seconds, never zero", () => {
    /*
     * `Retry-After: 0` invites an immediate retry into a window that has not
     * rolled, which is the one answer worse than no header. A sub-second wait
     * rounds up to 1.
     */
    expect(retryAfterHeader(0)).toEqual({ "retry-after": "1" });
    expect(retryAfterHeader(0.2)).toEqual({ "retry-after": "1" });
    expect(retryAfterHeader(30)).toEqual({ "retry-after": "30" });
    expect(retryAfterHeader(30.1)).toEqual({ "retry-after": "31" });
  });

  it("rides on a success as well as a refusal", () => {
    const response = apiOk({ id: "1" }, rateHeaders({ limit: 240, remaining: 239, resetSeconds: 60 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("ratelimit-remaining")).toBe("239");
    // And does not disturb the envelope headers every response carries.
    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });
});
