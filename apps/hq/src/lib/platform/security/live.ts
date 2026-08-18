/**
 * Live sessions and where they are coming from.
 *
 * Raw SQL, because these are correlated subqueries over the session table that the query builder
 * cannot express without materialising the join. Each one is commented with what it counts.
 */

import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  account,
  apiKeys,
  session as sessionTable,
  shops,
  twoFactor,
  user,
  webhookEndpoints,
} from "@sailo/db/schema";
import { parseUserAgent } from "@sailo/analytics/traffic";
import { requireStaff } from "@/lib/session";
import { num } from "../pagination";
import { notStaff } from "../roster";
import { PAID, live } from "./paid";

/* -------------------------------------------------------------------------- */
/*  Accounts worth a second look                                               */
/* -------------------------------------------------------------------------- */

/*
 * The per-account facts the watchlist is judged on, as scalar subqueries.
 *
 * Written out rather than joined and grouped: every one of them is a different
 * table with a different grain, and a five-way join with a GROUP BY would
 * multiply rows before it counted them. Same reasoning — and the same trap
 * about bare column names inside a subquery — as the aggregates in
 * `accounts.ts`; both queries here have joins, so the interpolated references
 * are qualified.
 */
const LIVE_SESSIONS = sql<string>`(
  select count(*) from "session" s
  where s.user_id = ${user.id} and s.expires_at > now()
)`;

const SESSION_COUNTRIES = sql<string>`(
  select count(distinct s.country) from "session" s
  where s.user_id = ${user.id} and s.expires_at > now() and s.country is not null
)`;

const LIVE_KEYS = sql<string>`(
  select count(*) from api_keys k
  where k.shop_id = ${shops.id} and k.revoked_at is null
)`;

const DEAD_HOOKS = sql<string>`(
  select count(*) from webhook_endpoints w
  where w.shop_id = ${shops.id} and not w.is_active
)`;

const FAILED_CODES = sql<string>`(
  select coalesce(max(t.failed_verification_count), 0) from two_factor t
  where t.user_id = ${user.id}
)`;

export type WatchRow = {
  userId: string;
  name: string;
  email: string;
  shopName: string | null;
  handle: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  takesCards: boolean;
  published: boolean;
  suspended: boolean;
  liveSessions: number;
  countries: number;
  liveKeys: number;
  deadHooks: number;
  failedCodes: number;
  /** Why this row is here, worst first. */
  reasons: { key: string; tone: "red" | "amber"; text: string }[];
};

/**
 * The accounts a security-minded person would open first.
 *
 * Every row is a *fact*, not a score: "takes cards, no second factor" is
 * something you can act on, and a risk number out of ten is something you argue
 * about. The list is ordered by how bad the worst fact on the row is, so the
 * top of it is the day's work and the bottom is housekeeping.
 *
 * A quiet list is the intended steady state. This is not a queue that has to
 * have something in it.
 */
/**
 * How many accounts the watchlist shows.
 *
 * Exported so the page can state the cap using the same number the query
 * applies. A screen that hard-codes "40" beside a query that fetches some other
 * amount is a sentence that goes quietly wrong the first time either moves.
 */
export const WATCHLIST_LIMIT = 40;

export async function getSecurityWatchlist(limit = WATCHLIST_LIMIT): Promise<WatchRow[]> {
  await requireStaff();

  const flagged = or(
    // Money on the line with one factor guarding it.
    and(eq(shops.stripeChargesEnabled, true), eq(user.twoFactorEnabled, false)),
    and(PAID, eq(user.twoFactorEnabled, false)),
    // A published shop whose owner never proved they hold the mailbox — which
    // is also the mailbox every password reset would go to.
    and(eq(shops.isPublished, true), eq(user.emailVerified, false)),
    sql`${SESSION_COUNTRIES} > 1`,
    sql`${LIVE_SESSIONS} >= 5`,
    sql`${FAILED_CODES} > 0`,
    sql`${DEAD_HOOKS} > 0`,
  );

  const rows = await getDb()
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      shopName: shops.name,
      handle: shops.handle,
      takesCards: shops.stripeChargesEnabled,
      published: shops.isPublished,
      suspendedAt: shops.suspendedAt,
      liveSessions: LIVE_SESSIONS,
      countries: SESSION_COUNTRIES,
      liveKeys: LIVE_KEYS,
      deadHooks: DEAD_HOOKS,
      failedCodes: FAILED_CODES,
    })
    .from(user)
    .leftJoin(shops, eq(shops.userId, user.id))
    .where(and(notStaff(), flagged))
    // Cheap pre-sort so the cap takes the busiest accounts, not an arbitrary
    // page of them. The real ordering is by severity, below.
    .orderBy(desc(SESSION_COUNTRIES), desc(LIVE_SESSIONS))
    .limit(limit);

  return rows
    .map((row): WatchRow => {
      const liveSessions = num(row.liveSessions);
      const countries = num(row.countries);
      const liveKeys = num(row.liveKeys);
      const deadHooks = num(row.deadHooks);
      const failedCodes = num(row.failedCodes);

      const reasons: WatchRow["reasons"] = [];

      if (countries > 1) {
        reasons.push({
          key: "countries",
          tone: "red",
          text: `Signed in from ${countries} countries at once`,
        });
      }
      if (failedCodes > 0) {
        reasons.push({
          key: "codes",
          tone: "red",
          text: `${failedCodes} failed two-factor ${failedCodes === 1 ? "attempt" : "attempts"}`,
        });
      }
      if (row.takesCards && !row.twoFactorEnabled) {
        reasons.push({
          key: "cards",
          tone: "red",
          text: "Takes card payments with no second factor",
        });
      }
      if (row.published && !row.emailVerified) {
        reasons.push({
          key: "unverified",
          tone: "amber",
          text: "Shop is live but the email was never verified",
        });
      }
      if (!row.twoFactorEnabled && !row.takesCards) {
        reasons.push({
          key: "no2fa",
          tone: "amber",
          text: "No second factor",
        });
      }
      if (liveSessions >= 5) {
        reasons.push({
          key: "sessions",
          tone: "amber",
          text: `${liveSessions} devices signed in`,
        });
      }
      if (deadHooks > 0) {
        reasons.push({
          key: "hooks",
          tone: "amber",
          text: `${deadHooks} webhook ${deadHooks === 1 ? "endpoint" : "endpoints"} switched off after failing`,
        });
      }

      return {
        userId: row.userId,
        name: row.name,
        email: row.email,
        shopName: row.shopName,
        handle: row.handle,
        emailVerified: row.emailVerified,
        twoFactorEnabled: row.twoFactorEnabled,
        takesCards: Boolean(row.takesCards),
        published: Boolean(row.published),
        suspended: Boolean(row.suspendedAt),
        liveSessions,
        countries,
        liveKeys,
        deadHooks,
        failedCodes,
        reasons,
      };
    })
    /*
     * A row with a red reason outranks any number of amber ones. Sorting on a
     * count of reasons instead would put "no 2FA, five devices, a dead webhook"
     * above "signed in from three countries", which is the wrong way round.
     */
    .toSorted((a, b) => severity(a) - severity(b) || b.reasons.length - a.reasons.length);
}

/** 0 for a row with anything red on it, 1 for the rest. */
function severity(row: WatchRow): number {
  return row.reasons.some((reason) => reason.tone === "red") ? 0 : 1;
}

/* -------------------------------------------------------------------------- */
/*  One account's security, in full                                            */
/* -------------------------------------------------------------------------- */

export type AccountSecurity = Awaited<ReturnType<typeof getAccountSecurity>>;

/**
 * What guards this account, what is signed into it, and what it has handed out.
 *
 * `shopId` is passed in rather than looked up, because the caller — the account
 * page — has already loaded the shop and a second query for its id would be a
 * round trip to learn something it is holding. An account with no shop passes
 * null and gets no keys and no endpoints, which is the truth: both hang off a
 * shop, and somebody who stopped during onboarding has neither.
 */
export async function getAccountSecurity(userId: string, shopId?: string | null) {
  await requireStaff();
  const db = getDb();

  const [rows, enrolment, providers, keys, hooks] = await Promise.all([
    db
      .select({
        id: sessionTable.id,
        ipAddress: sessionTable.ipAddress,
        city: sessionTable.city,
        country: sessionTable.country,
        userAgent: sessionTable.userAgent,
        createdAt: sessionTable.createdAt,
        lastSeenAt: sessionTable.updatedAt,
        expiresAt: sessionTable.expiresAt,
      })
      .from(sessionTable)
      .where(and(eq(sessionTable.userId, userId), live()))
      .orderBy(desc(sessionTable.createdAt)),

    /*
     * The enrolment row's counters, never its columns. `secret` and
     * `backupCodes` are encrypted credentials and are not selected — there is
     * no question a staff member can answer by seeing them, and one screenshot
     * where they are visible is a compromise of every account on the page.
     */
    db
      .select({
        verified: twoFactor.verified,
        failedVerificationCount: twoFactor.failedVerificationCount,
        lockedUntil: twoFactor.lockedUntil,
        // Answered by the database rather than by comparing the stamp to the
        // clock in a component: a component that reads `Date.now()` renders
        // differently every time it is called, which React is right to object
        // to. Same reasoning as `daysBehind` in `system.ts`.
        locked: sql<boolean>`${twoFactor.lockedUntil} > now()`,
      })
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId)),

    // Likewise: which providers are linked and whether a password exists —
    // never the tokens or the hash.
    db
      .select({
        id: account.id,
        providerId: account.providerId,
        hasPassword: sql<boolean>`${account.password} is not null`,
        createdAt: account.createdAt,
      })
      .from(account)
      .where(eq(account.userId, userId))
      .orderBy(desc(account.createdAt)),

    shopId
      ? db
          .select({
            id: apiKeys.id,
            label: apiKeys.label,
            prefix: apiKeys.prefix,
            scopes: apiKeys.scopes,
            lastUsedAt: apiKeys.lastUsedAt,
            revokedAt: apiKeys.revokedAt,
            createdAt: apiKeys.createdAt,
          })
          .from(apiKeys)
          .where(eq(apiKeys.shopId, shopId))
          .orderBy(desc(apiKeys.createdAt))
      : Promise.resolve([]),

    shopId
      ? db
          .select({
            id: webhookEndpoints.id,
            url: webhookEndpoints.url,
            label: webhookEndpoints.label,
            events: webhookEndpoints.events,
            isActive: webhookEndpoints.isActive,
            disabledReason: webhookEndpoints.disabledReason,
            failureCount: webhookEndpoints.failureCount,
            lastStatus: webhookEndpoints.lastStatus,
            lastAttemptAt: webhookEndpoints.lastAttemptAt,
          })
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.shopId, shopId))
          .orderBy(desc(webhookEndpoints.createdAt))
      : Promise.resolve([]),
  ]);

  const sessions = rows.map(({ userAgent, ...rest }) => ({
    ...rest,
    ...parseUserAgent(userAgent),
  }));

  const [twoFactorRow] = enrolment;

  return {
    sessions,
    countries: [...new Set(sessions.map((s) => s.country).filter(Boolean))] as string[],
    twoFactor: twoFactorRow
      ? {
          enrolled: true,
          verified: twoFactorRow.verified,
          failedVerificationCount: twoFactorRow.failedVerificationCount,
          lockedUntil: twoFactorRow.lockedUntil,
          locked: Boolean(twoFactorRow.locked),
        }
      : null,
    providers,
    keys,
    hooks,
  };
}
