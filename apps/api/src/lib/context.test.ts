import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { shops } from "@sailo/db/schema";

/**
 * The API app's authorisation boundary.
 *
 * Everything `@sailo/api` will do for a caller is decided by the one field
 * this returns. `shopId: null` is a caller who can read nothing; any other
 * value is full access to that shop — so the two things worth pinning are that
 * an unauthenticated request cannot get a non-null id, and that the id is
 * derived from the session rather than from anything the client sent.
 */

const { getSession, findFirst } = vi.hoisted(() => ({
  getSession: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock("@sailo/db", () => ({ getDb: () => ({ query: { shops: { findFirst } } }) }));

const { createContext } = await import("./context");

const bearer = (token: string) =>
  new Request("https://api.sailo.store/api/trpc/shop.get", {
    headers: { Authorization: `Bearer ${token}` },
  });

beforeEach(() => {
  getSession.mockReset();
  findFirst.mockReset();
});

describe("createContext", () => {
  it("gives an anonymous caller no shop", async () => {
    getSession.mockResolvedValue(null);

    await expect(createContext(new Request("https://api.sailo.store/api/trpc"))).resolves.toEqual({
      shopId: null,
      userId: null,
    });
  });

  it("does not touch the database for a caller with no session", async () => {
    // An unauthenticated request is the cheap one to flood, so it must not
    // reach Postgres at all.
    getSession.mockResolvedValue(null);

    await createContext(new Request("https://api.sailo.store/api/trpc"));
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("treats a session without a user as no session", async () => {
    // better-auth can resolve a record while leaving `user` undefined; reading
    // that as authenticated would dereference it a line later.
    getSession.mockResolvedValue({ session: { id: "sess_1" } });

    await expect(createContext(bearer("tok"))).resolves.toEqual({ shopId: null, userId: null });
  });

  it("resolves a bearer token to that seller's shop", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    findFirst.mockResolvedValue({ id: "shop_1" });

    await expect(createContext(bearer("tok_abc"))).resolves.toEqual({ shopId: "shop_1", userId: "user_1" });
  });

  it("hands better-auth the request's own headers, so the bearer plugin sees the token", async () => {
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    findFirst.mockResolvedValue({ id: "shop_1" });

    const req = bearer("tok_abc");
    await createContext(req);

    expect(getSession).toHaveBeenCalledWith({ headers: req.headers });
    expect(getSession.mock.calls[0]?.[0].headers.get("Authorization")).toBe("Bearer tok_abc");
  });

  it("scopes the shop lookup to the session's user, not to anything the client sent", async () => {
    /*
     * The id comes from the verified session and nowhere else. If this ever
     * keyed off a header or a body field, a seller could name another seller's
     * shop and every procedure downstream would happily scope to it.
     */
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    findFirst.mockResolvedValue({ id: "shop_1" });

    await createContext(bearer("tok_abc"));

    expect(findFirst).toHaveBeenCalledWith({ where: eq(shops.userId, "user_1") });
  });

  it("gives a signed-in seller who has no shop yet an identity but no shop", async () => {
    /*
     * A real state, and the one the sign-up flow lives in: the account exists,
     * onboarding has not finished. `shopId` must read as null rather than as
     * undefined leaking through — and `userId` must **not**, because
     * `shop.create` is the procedure that ends this state and it has nothing
     * to file the new row against otherwise.
     */
    getSession.mockResolvedValue({ user: { id: "user_1" } });
    findFirst.mockResolvedValue(undefined);

    await expect(createContext(bearer("tok_abc"))).resolves.toEqual({
      shopId: null,
      userId: "user_1",
    });
  });
});
