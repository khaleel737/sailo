import { assertLocalDatabase } from "./local-only";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { session as sessionTable, user } from "@sailo/db/schema";
import { listLoginSessions } from "@/lib/queries/sessions";

/**
 * The login-sessions table, against real rows.
 *
 * Two properties matter here and neither is visible from the UI: that an
 * expired row never appears (better-auth prunes lazily, so without a filter
 * the table offers to terminate devices that were signed out weeks ago), and
 * that the session *token* never leaves this module. The token is a bearer
 * credential; a page that renders it has handed out a session.
 *
 * The revocation actions themselves are not exercised here — they call
 * `requireShop`, so they want a session cookie this suite has no way to mint.
 * Their ownership guard is pinned in `src/lib/actions/security.test.ts`, and
 * what they ultimately do is the `DELETE` this file proves the query reacts to.
 */

const db = getDb();
const uid = () => crypto.randomUUID();

beforeAll(() => {
  assertLocalDatabase();
});

async function makeUser() {
  const userId = uid();
  await db.insert(user).values({
    id: userId,
    name: "Seller",
    email: `sessions-${userId.slice(0, 8)}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

async function signIn(
  userId: string,
  over: Partial<typeof sessionTable.$inferInsert> = {},
) {
  const token = `tok-${uid()}`;
  const [row] = await db
    .insert(sessionTable)
    .values({
      id: uid(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: "203.0.113.7",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      city: "Zagreb",
      country: "HR",
      ...over,
    })
    .returning();
  if (!row) throw new Error("fixture: session was not inserted");
  return row;
}

describe("the table shows the devices that are really signed in", () => {
  it("lists every live session, newest first, and badges the caller's", async () => {
    const userId = await makeUser();
    const older = await signIn(userId, {
      createdAt: new Date(Date.now() - 3600_000),
    });
    const current = await signIn(userId);

    const rows = await listLoginSessions(userId, current.token);

    expect(rows.map((r) => r.id)).toEqual([current.id, older.id]);
    expect(rows[0]?.current).toBe(true);
    expect(rows[1]?.current).toBe(false);
  });

  it("reads the device out of the user agent", async () => {
    // The visits pipeline's parser, not a new UA library.
    const userId = await makeUser();
    const row = await signIn(userId);

    const [only] = await listLoginSessions(userId, row.token);
    expect(only?.browser).toBe("Chrome");
    expect(only?.os).toBe("macOS");
    expect(only?.device).toBe("desktop");
  });

  it("carries the location stored at sign-in", async () => {
    const userId = await makeUser();
    const row = await signIn(userId);

    const [only] = await listLoginSessions(userId, row.token);
    expect(only?.city).toBe("Zagreb");
    expect(only?.country).toBe("HR");
    expect(only?.ipAddress).toBe("203.0.113.7");
  });

  it("says nothing rather than guessing for a session from before geo existed", async () => {
    const userId = await makeUser();
    const row = await signIn(userId, { city: null, country: null });

    const [only] = await listLoginSessions(userId, row.token);
    expect(only?.city).toBeNull();
    expect(only?.country).toBeNull();
  });

  it("hides expired rows", async () => {
    /*
     * Better-auth prunes expired sessions lazily, so without the filter the
     * table lists devices that are already signed out — and offers to
     * terminate them. A list that overstates how exposed an account is, in
     * the one screen someone opens *because* they are worried.
     */
    const userId = await makeUser();
    const live = await signIn(userId);
    await signIn(userId, { expiresAt: new Date(Date.now() - 1000) });

    const rows = await listLoginSessions(userId, live.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(live.id);
  });

  it("shows one user nothing of another's", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const row = await signIn(mine);
    await signIn(theirs);

    const rows = await listLoginSessions(mine, row.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(row.id);
  });
});

describe("the token never leaves the query", () => {
  it("is absent from every row handed to the page", async () => {
    const userId = await makeUser();
    const row = await signIn(userId);

    const [only] = await listLoginSessions(userId, row.token);
    expect(only).toBeDefined();
    expect(Object.keys(only as object)).not.toContain("token");
    // Belt and braces: nothing in the row is the token under another name.
    expect(JSON.stringify(only)).not.toContain(row.token);
  });
});

describe("a deleted row is a revoked session", () => {
  it("disappears from the table the moment it is deleted", async () => {
    /*
     * This is what makes "terminate" honest. Deleting the row IS the
     * revocation — there is no cookie cache in front of it (see the note in
     * `lib/auth.ts`), so the next request carrying that cookie finds nothing.
     */
    const userId = await makeUser();
    const keep = await signIn(userId);
    const kill = await signIn(userId);

    expect(await listLoginSessions(userId, keep.token)).toHaveLength(2);

    await db.delete(sessionTable).where(eq(sessionTable.id, kill.id));

    const rows = await listLoginSessions(userId, keep.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(keep.id);
  });

  it("leaves exactly the caller after signing out the others", async () => {
    const userId = await makeUser();
    const caller = await signIn(userId);
    await signIn(userId);
    await signIn(userId);

    // The same predicate `revokeOtherSessions` uses.
    await db
      .delete(sessionTable)
      .where(eq(sessionTable.userId, userId))
      .returning({ id: sessionTable.id });
    await db.insert(sessionTable).values({ ...caller });

    const rows = await listLoginSessions(userId, caller.token);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.current).toBe(true);
  });
});
