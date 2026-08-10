import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { session as sessionTable } from "@/db/schema";
import { parseUserAgent } from "@/lib/analytics";

/** The signed-in devices a seller sees in Settings → Security. */

export type LoginSession = {
  /** The row id — the only handle the page is allowed to render. */
  id: string;
  /** Where the sign-in came from, if the geo headers said. */
  city: string | null;
  country: string | null;
  ipAddress: string | null;
  device: "mobile" | "tablet" | "desktop";
  os: string | null;
  browser: string | null;
  createdAt: Date;
  /** The one row whose terminate button is a sign-out. */
  current: boolean;
};

/**
 * Every live session for one user, newest first.
 *
 * Expired rows are filtered rather than shown: better-auth prunes them
 * lazily, so without this the table lists devices that were signed out weeks
 * ago and offers to terminate them — a list that lies in the direction of
 * "you are less secure than you are".
 *
 * The session *token* is deliberately not in the returned shape. It is a
 * bearer credential; the page never needs it, and a page that never has it
 * cannot leak it into markup, a log or a client component's props.
 */
export async function listLoginSessions(
  userId: string,
  currentToken: string,
): Promise<LoginSession[]> {
  const rows = await getDb()
    .select({
      id: sessionTable.id,
      token: sessionTable.token,
      city: sessionTable.city,
      country: sessionTable.country,
      ipAddress: sessionTable.ipAddress,
      userAgent: sessionTable.userAgent,
      createdAt: sessionTable.createdAt,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.userId, userId),
        gt(sessionTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessionTable.createdAt));

  return rows.map((row) => {
    // The visits pipeline's parser, not a new UA library: this answers the
    // same question ("which device is this?") and needs no more precision.
    const { device, os, browser } = parseUserAgent(row.userAgent);
    return {
      id: row.id,
      city: row.city,
      country: row.country,
      ipAddress: row.ipAddress,
      device,
      os,
      browser,
      createdAt: row.createdAt,
      current: row.token === currentToken,
    };
  });
}
