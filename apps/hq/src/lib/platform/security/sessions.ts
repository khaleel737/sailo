/**
 * Who is signed in, filtered, paged and exportable.
 *
 * The filters are a type rather than a bag of optional arguments because the same shape backs a
 * URL, a form and an export — and an export that quietly ignored a filter the screen applied
 * would hand somebody a wider list than they asked for.
 */

import "server-only";
import { and, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getReadDb } from "@sailo/db";
import { session as sessionTable, shops, user } from "@sailo/db/schema";
import { parseUserAgent } from "@sailo/analytics/traffic";
import { requireStaff } from "@/lib/session";
import { isStaffEmail } from "@sailo/security/staff";
import { HQ_PAGE_SIZE, daysAgo, like, num, paginate } from "../pagination";
import { live } from "./paid";

/* -------------------------------------------------------------------------- */
/*  Every device signed in right now                                           */
/* -------------------------------------------------------------------------- */

export type SessionRow = {
  id: string;
  userId: string;
  name: string;
  email: string;
  /** One of us, not a seller — the row is still shown, but labelled. */
  staff: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  shopName: string | null;
  handle: string | null;
  ipAddress: string | null;
  city: string | null;
  country: string | null;
  device: "mobile" | "tablet" | "desktop";
  os: string | null;
  browser: string | null;
  createdAt: Date;
  /** Coarse: better-auth refreshes it at most once a day. */
  lastSeenAt: Date;
  expiresAt: Date;
};

export type SessionFilters = {
  q?: string;
  /** ISO-3166 alpha-2, or "all". */
  country?: string;
  /** day | week | all — when the session *started*. */
  window?: string;
  page?: number;
};

function sessionWhere(filters: SessionFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [live()];

  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(user.name, pattern),
        ilike(user.email, pattern),
        ilike(shops.handle, pattern),
        // An IP is the thing you paste in from an abuse report, so it searches
        // like a name does rather than needing its own field.
        ilike(sessionTable.ipAddress, pattern),
      ),
    );
  }

  if (filters.country && filters.country !== "all") {
    clauses.push(eq(sessionTable.country, filters.country));
  }

  if (filters.window === "day") clauses.push(gte(sessionTable.createdAt, daysAgo(1)));
  if (filters.window === "week") clauses.push(gte(sessionTable.createdAt, daysAgo(7)));

  const present = clauses.filter(Boolean);
  return present.length > 0 ? and(...present) : undefined;
}

/**
 * One page of live sessions across the whole platform, newest first.
 *
 * This is the list you open when a seller mails "someone else is in my
 * account", and the list you scan after any credential scare. The user agent is
 * parsed in JavaScript rather than stored parsed, so a device column costs
 * nothing at write time and nothing at read time beyond the page in hand.
 */
export async function getSessions(filters: SessionFilters = {}) {
  await requireStaff();
  const db = getReadDb();
  const where = sessionWhere(filters);

  const result = await paginate(
    filters.page ?? 1,
    (offset) =>
      db
        .select({
          id: sessionTable.id,
          userId: sessionTable.userId,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          shopName: shops.name,
          handle: shops.handle,
          ipAddress: sessionTable.ipAddress,
          city: sessionTable.city,
          country: sessionTable.country,
          userAgent: sessionTable.userAgent,
          createdAt: sessionTable.createdAt,
          lastSeenAt: sessionTable.updatedAt,
          expiresAt: sessionTable.expiresAt,
        })
        .from(sessionTable)
        .innerJoin(user, eq(user.id, sessionTable.userId))
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where)
        .orderBy(desc(sessionTable.createdAt))
        .limit(HQ_PAGE_SIZE)
        .offset(offset),

    async () => {
      const [totals] = await db
        .select({ n: sql<string>`count(*)` })
        .from(sessionTable)
        .innerJoin(user, eq(user.id, sessionTable.userId))
        .leftJoin(shops, eq(shops.userId, user.id))
        .where(where);
      return num(totals?.n);
    },
  );

  return {
    ...result,
    rows: result.rows.map((row): SessionRow => {
      const { userAgent, ...rest } = row;
      return {
        ...rest,
        ...parseUserAgent(userAgent),
        staff: isStaffEmail(row.email),
      };
    }),
  };
}

/**
 * Every live session, for the CSV.
 *
 * Bounded like the other exports, and unfiltered on purpose: this is the file
 * that gets attached to an incident ticket, and a filtered snapshot of an
 * incident is how you conclude the wrong thing about it a week later.
 */
export async function getAllSessionsForExport(limit = 10_000) {
  await requireStaff();

  const rows = await getReadDb()
    .select({
      userId: sessionTable.userId,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      handle: shops.handle,
      ipAddress: sessionTable.ipAddress,
      city: sessionTable.city,
      country: sessionTable.country,
      userAgent: sessionTable.userAgent,
      createdAt: sessionTable.createdAt,
      lastSeenAt: sessionTable.updatedAt,
      expiresAt: sessionTable.expiresAt,
    })
    .from(sessionTable)
    .innerJoin(user, eq(user.id, sessionTable.userId))
    .leftJoin(shops, eq(shops.userId, user.id))
    .where(live())
    .orderBy(desc(sessionTable.createdAt))
    .limit(limit);

  return rows.map(({ userAgent, ...rest }) => ({
    ...rest,
    ...parseUserAgent(userAgent),
    staff: isStaffEmail(rest.email),
  }));
}

/** The countries the filter offers — only ones that actually appear. */
export async function getSessionCountryOptions() {
  await requireStaff();
  const rows = await getReadDb()
    .selectDistinct({ country: sessionTable.country })
    .from(sessionTable)
    .where(and(live(), isNotNull(sessionTable.country)));

  return rows.map((r) => r.country).filter((c): c is string => Boolean(c));
}
