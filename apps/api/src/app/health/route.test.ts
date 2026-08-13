import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * The health check's whole value is that it answers when nothing else does, so
 * the thing worth asserting is what it *doesn't* touch: importing this module
 * must not reach the database, Redis or better-auth. It is imported here with
 * no mocks and no `DATABASE_URL`, which is the test — a dependency creeping in
 * would throw on import and fail this file before an assertion runs.
 */
describe("GET /health", () => {
  it("answers 200", async () => {
    expect((await GET()).status).toBe(200);
  });

  it("names the service, so a shared monitor can tell the two apps apart", async () => {
    await expect((await GET()).json()).resolves.toEqual({ ok: true, service: "api" });
  });
});
