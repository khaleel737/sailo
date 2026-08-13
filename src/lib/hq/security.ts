import "server-only";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  account,
  apiKeys,
  session as sessionTable,
  shops,
  twoFactor,
  user,
  webhookEndpoints,
} from "@/db/schema";
import { parseUserAgent } from "@/lib/analytics";
import { requireStaff } from "@/lib/session";
import { isStaffEmail } from "@/lib/staff";
import { ENTITLED } from "./billing-state";
import { HQ_PAGE_SIZE, daysAgo, like, num, paginate, utcDayWindow } from "./pagination";
import { notStaff } from "./roster";

/* ===========================================================================
   Who is signed in, on what, and which accounts are one stolen password away
   from being someone else's.

   /admin/settings/security answers this for one seller about themselves. This
   answers it for us about all of them — and it is the one part of HQ where the
   platform-wide view is worth more than the sum of the per-account ones: a
   single seller signed in from two countries is a holiday, and forty of them in
   a week is an incident.

   Everything here is *metadata*. No session token, no API key, no 2FA secret,
   no backup code and no OAuth token is selected by any query in this file, and
   none of them should ever be — a staff screen is one shared screenshot away
   from being a credential leak, and the only reliable defence is for the
   credential never to reach the page. Row ids travel instead; the actions in
   `actions/hq.ts` resolve them server-side.

   And every read here is on the primary, unlike the rest of HQ's aggregates.
   `db/index.ts` names sessions as a thing a replica must not serve, and the
   reason survives the change of purpose: a page whose entire job is to say who
   is signed in *right now* cannot be built on rows from an unbounded moment
   ago, and staff revoke straight off these lists. The tables are small — one
   row per signed-in device, per enrolment, per key — so there is no scan here
   worth moving off the primary anyway. That is the trade `overview.ts` makes
   in the other direction, and for the opposite reason.
=========================================================================== */

/** Live rows only. Better-auth prunes expired sessions lazily, so a query that
 *  forgets this reports devices that were signed out weeks ago as signed in. */
const live = () => gt(sessionTable.expiresAt, new Date());

/**
 * Shops entitled to a paid plan, comped or billed.
 *
 * The same rule `billingState()` applies, reused here so "paying accounts
 * without 2FA" counts the same population the revenue page does.
 */
const PAID = or(
  isNotNull(shops.compPlan),
  and(ne(shops.plan, "free"), inArray(shops.subscriptionStatus, ENTITLED)),
);

/* -------------------------------------------------------------------------- */
/*  The platform's security posture, in numbers                                */
/* -------------------------------------------------------------------------- */

/** Everything the security page's tiles are made of. */
export async function getSecurityOverview() {
  await requireStaff();
  const db = getDb();

  const day = daysAgo(1);
  const week = daysAgo(7);
  const quarter = daysAgo(90);

  const [
    [accounts],
    [sessions],
    countries,
    [exposure],
    [enrolment],
    [keys],
    [hooks],
  ] = await Promise.all([
    // Customers only, like every other account figure in HQ — counting our own
    // staff row would flatter 2FA adoption by exactly one.
    db
      .select({
        total: sql<string>`count(*)`,
        twoFactor: sql<string>`count(*) filter (where ${user.twoFactorEnabled})`,
        unverified: sql<string>`count(*) filter (where not ${user.emailVerified})`,
        newWeek: sql<string>`count(*) filter (where ${user.createdAt} >= ${week})`,
      })
      .from(user)
      .where(notStaff()),

    /*
     * Sessions are counted for *everyone*, staff included. Every other list in
     * HQ excludes us because we are not a customer; here we are as much of an
     * attack surface as any seller — more, since our sessions open this panel —
     * and a security page that hides its own operators' devices is decoration.
     * The table marks them, rather than dropping them.
     */
    db
      .select({
        live: sql<string>`count(*)`,
        accounts: sql<string>`count(distinct ${sessionTable.userId})`,
        day: sql<string>`count(*) filter (where ${sessionTable.createdAt} >= ${day})`,
        week: sql<string>`count(*) filter (where ${sessionTable.createdAt} >= ${week})`,
        // `updatedAt` is refreshed at most once a day (`updateAge` in
        // lib/auth.ts), so this is "used since yesterday", not "online now".
        seenDay: sql<string>`count(*) filter (where ${sessionTable.updatedAt} >= ${day})`,
        located: sql<string>`count(*) filter (where ${sessionTable.country} is not null)`,
      })
      .from(sessionTable)
      .where(live()),

    db
      .select({
        country: sessionTable.country,
        sessions: sql<string>`count(*)`,
        accounts: sql<string>`count(distinct ${sessionTable.userId})`,
      })
      .from(sessionTable)
      .where(and(live(), isNotNull(sessionTable.country)))
      .groupBy(sessionTable.country)
      .orderBy(desc(sql`count(*)`))
      .limit(10),

    // What an account compromise would actually cost — a shop taking cards, or
    // one we bill, is worth more to steal than an empty one.
    db
      .select({
        shops: sql<string>`count(*)`,
        takingCards: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled})`,
        cardsNoTwoFactor: sql<string>`count(*) filter (where ${shops.stripeChargesEnabled} and not ${user.twoFactorEnabled})`,
        paidNoTwoFactor: sql<string>`count(*) filter (where ${PAID} and not ${user.twoFactorEnabled})`,
        liveUnverified: sql<string>`count(*) filter (where ${shops.isPublished} and not ${user.emailVerified})`,
      })
      .from(shops)
      .innerJoin(user, eq(user.id, shops.userId))
      /*
       * Customers only — and here that is not tidiness, it is the difference
       * between a banner and a wild goose chase. Our own shop is a shop like
       * any other, so without this it can be the "1 shop takes cards with no
       * second factor" the page shouts about, while the watchlist below it —
       * which does exclude us — sits empty.
       */
      .where(notStaff()),

    /*
     * The 2FA plugin's own lockout counters. A row with a non-zero failure
     * count is somebody typing codes that don't work — themselves on a phone
     * with a drifted clock, or someone else with their password.
     */
    db
      .select({
        enrolled: sql<string>`count(*)`,
        verified: sql<string>`count(*) filter (where ${twoFactor.verified})`,
        locked: sql<string>`count(*) filter (where ${twoFactor.lockedUntil} > now())`,
        failing: sql<string>`count(*) filter (where ${twoFactor.failedVerificationCount} > 0)`,
      })
      .from(twoFactor)
      // Same reason as the exposure counts: these drive a banner that links to
      // a list we are not in.
      .innerJoin(user, eq(user.id, twoFactor.userId))
      .where(notStaff()),

    db
      .select({
        total: sql<string>`count(*)`,
        live: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null)`,
        revoked: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is not null)`,
        usedWeek: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and ${apiKeys.lastUsedAt} >= ${week})`,
        // Live, and either never used or not used this quarter. A key nobody
        // is using is a credential with no upside left, only downside.
        dormant: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and (${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < ${quarter}))`,
        writable: sql<string>`count(*) filter (where ${apiKeys.revokedAt} is null and 'write' = any(${apiKeys.scopes}))`,
      })
      .from(apiKeys),

    db
      .select({
        total: sql<string>`count(*)`,
        active: sql<string>`count(*) filter (where ${webhookEndpoints.isActive})`,
        disabled: sql<string>`count(*) filter (where not ${webhookEndpoints.isActive})`,
        failing: sql<string>`count(*) filter (where ${webhookEndpoints.isActive} and ${webhookEndpoints.failureCount} > 0)`,
      })
      .from(webhookEndpoints),
  ]);

  return {
    accounts: {
      total: num(accounts?.total),
      twoFactor: num(accounts?.twoFactor),
      unverified: num(accounts?.unverified),
      newWeek: num(accounts?.newWeek),
    },
    sessions: {
      live: num(sessions?.live),
      accounts: num(sessions?.accounts),
      day: num(sessions?.day),
      week: num(sessions?.week),
      seenDay: num(sessions?.seenDay),
      located: num(sessions?.located),
    },
    countries: countries.map((row) => ({
      country: row.country,
      sessions: num(row.sessions),
      accounts: num(row.accounts),
    })),
    exposure: {
      shops: num(exposure?.shops),
      takingCards: num(exposure?.takingCards),
      cardsNoTwoFactor: num(exposure?.cardsNoTwoFactor),
      paidNoTwoFactor: num(exposure?.paidNoTwoFactor),
      liveUnverified: num(exposure?.liveUnverified),
    },
    twoFactor: {
      enrolled: num(enrolment?.enrolled),
      verified: num(enrolment?.verified),
      locked: num(enrolment?.locked),
      failing: num(enrolment?.failing),
    },
    keys: {
      total: num(keys?.total),
      live: num(keys?.live),
      revoked: num(keys?.revoked),
      usedWeek: num(keys?.usedWeek),
      dormant: num(keys?.dormant),
      writable: num(keys?.writable),
    },
    webhooks: {
      total: num(hooks?.total),
      active: num(hooks?.active),
      disabled: num(hooks?.disabled),
      failing: num(hooks?.failing),
    },
  };
}

/**
 * Sessions started per day.
 *
 * Deliberately short: sessions expire after 30 days and the row goes with them,
 * so a 30-day chart drawn from this table slopes to nothing at the left-hand
 * end and looks like a collapse in sign-ins that never happened. Two weeks is
 * inside the window everywhere, so every bucket is complete.
 */
export async function getSignInSeries(days = 14) {
  await requireStaff();
  const { since, keys } = utcDayWindow(days);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(${sessionTable.createdAt}::date, 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(sessionTable)
    .where(gte(sessionTable.createdAt, since))
    .groupBy(sql`${sessionTable.createdAt}::date`);

  const byDay = new Map(rows.map((r) => [r.day, num(r.count)]));
  return keys.map((day) => ({ day, value: byDay.get(day) ?? 0 }));
}

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
  const db = getDb();
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

  const rows = await getDb()
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
  const rows = await getDb()
    .selectDistinct({ country: sessionTable.country })
    .from(sessionTable)
    .where(and(live(), isNotNull(sessionTable.country)));

  return rows.map((r) => r.country).filter((c): c is string => Boolean(c));
}

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
export async function getSecurityWatchlist(limit = 40): Promise<WatchRow[]> {
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
