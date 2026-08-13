import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as blocklistState from "@/lib/blocklist/state";

/**
 * The guard, and that it comes first.
 *
 * A cron route is a public URL — the schedule is the only thing that usually
 * calls it, not the only thing that can. This one queries public DNS zones that
 * throttle and refuse a querier who asks too often, so an unauthenticated
 * stranger hammering it does not just cost us compute: it gets us blocked by
 * the very zones the check depends on, which disables the check silently. The
 * assertion that matters is therefore not only the status code but that no
 * lookup happened on the way to it.
 */

const resolve4 = vi.hoisted(() => vi.fn<(name: string) => Promise<string[]>>());
vi.mock("node:dns/promises", () => ({ resolve4 }));

/* Redis and Resend have no business in a unit test. */
const readLastCheck = vi.hoisted(() => vi.fn(async () => null));
const writeLastCheck = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/blocklist/state", async (importOriginal) => ({
  ...(await importOriginal<typeof blocklistState>()),
  readLastCheck,
  writeLastCheck,
}));

const sendBlocklistAlert = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/blocklist/alert", () => ({
  sendBlocklistAlert,
  sendBlocklistCleared: vi.fn(async () => []),
}));

import { GET } from "./route";

const url = "https://sailo.store/api/cron/blocklist";
const original = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  resolve4.mockRejectedValue(
    Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" }),
  );
});

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("GET /api/cron/blocklist", () => {
  it("refuses a request with no bearer token, before looking anything up", async () => {
    const response = await GET(new Request(url));

    expect(response.status).toBe(401);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("refuses a request with the wrong token", async () => {
    const response = await GET(
      new Request(url, { headers: { authorization: "Bearer nope" } }),
    );

    expect(response.status).toBe(401);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("refuses everyone when CRON_SECRET is not configured", async () => {
    // A missing secret is a misconfiguration, and the safe reading of one on an
    // endpoint that sends mail is "no", not "yes to everyone".
    delete process.env.CRON_SECRET;

    const response = await GET(
      new Request(url, { headers: { authorization: "Bearer test-secret" } }),
    );

    expect(response.status).toBe(500);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("checks the sending domains, and stays quiet when they are clean", async () => {
    const response = await GET(
      new Request(url, { headers: { authorization: "Bearer test-secret" } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      verdict: "quiet",
    });
    expect(resolve4).toHaveBeenCalled();
    expect(sendBlocklistAlert).not.toHaveBeenCalled();
    expect(writeLastCheck).toHaveBeenCalled();
  });
});
